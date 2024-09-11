const ecomUtils = require('@ecomplus/utils')
const axios = require('axios')
const { logger } = require('../../../context')
const admin = require('firebase-admin')
const { setup } = require('@ecomplus/application-sdk')

const getAppSdk = () => {
  return new Promise(resolve => {
    setup(null, true, admin.firestore())
      .then(appSdk => resolve(appSdk))
  })
}

const getProductById = (appSdk, storeId, auth, productId) => appSdk
  .apiRequest(storeId, `/products/${productId}.json`, 'GET', null, auth)
  .then(({ response }) => response.data)
  .catch(logger.error)

const updateProductById = (appSdk, storeId, auth, productId, body) => appSdk
  .apiRequest(storeId, `/products/${productId}.json`, 'PATCH', body, auth)

const tryImageUpload = (storeId, auth, originImgUrl, product, index, isRetry) => new Promise(resolve => {
  axios.get(originImgUrl, {
    responseType: 'arraybuffer'
  })
    .then(({ data }) => {
      const form = new FormData()
      form.append('file', Buffer.from(data), originImgUrl.replace(/.*\/([^/]+)$/, '$1'))

      return axios.post(`https://apx-storage.e-com.plus/${storeId}/api/v1/upload.json`, form, {
        headers: {
          ...form.getHeaders(),
          'X-Store-ID': storeId,
          'X-My-ID': auth.myId,
          'X-Access-Token': auth.accessToken
        }
      })

        .then(({ data, status }) => {
          if (data.picture) {
            for (const imgSize in data.picture) {
              if (data.picture[imgSize]) {
                if (!data.picture[imgSize].url) {
                  delete data.picture[imgSize]
                  continue
                }
                if (data.picture[imgSize].size !== undefined) {
                  delete data.picture[imgSize].size
                }
                data.picture[imgSize].alt = `${product.name} (${imgSize})`
              }
            }
            if (Object.keys(data.picture).length) {
              return resolve({
                _id: ecomUtils.randomObjectId(),
                ...data.picture
              })
            }
          }
          const err = new Error('Unexpected Storage API response')
          err.response = { data, status }
          throw err
        })
    })

    .catch(err => {
      if (err.name !== 'Unexpected Storage API response' && !isRetry) {
        setTimeout(tryImageUpload(storeId, auth, originImgUrl, product, index, true), 700)
      } else {
        logger.error(err)
        resolve({
          _id: ecomUtils.randomObjectId(),
          normal: {
            url: originImgUrl,
            alt: product.name
          }
        })
      }
    })
})

  .then(picture => {
    if (product && product.pictures) {
      if (index === 0 || index) {
        product.pictures[index] = picture
      } else {
        product.pictures.push(picture)
      }
    }
    return picture
  })

const saveImagesProduct = async ({ appSdk, storeId, auth }, product, anexos) => {
  if (!product.pictures) {
    product.pictures = []
  }
  const promisesImgs = []
  anexos.forEach((anexo, i) => {
    let url
    if (anexo && anexo.anexo) {
      url = anexo.anexo
    } else if (anexo.url) {
      url = anexo.url
    }

    if (typeof url === 'string' && url.startsWith('http')) {
      let isImgExists = false
      let index = i
      if (product.pictures.length) {
        const pathImg = url.split('/')
        const nameImg = pathImg[pathImg.length - 1]
        const oldPictureIndex = product.pictures.length
          ? product.pictures.findIndex(({ normal }) => normal.url.includes(nameImg))
          : -1

        if (oldPictureIndex > -1) {
          index = oldPictureIndex
          const oldPicture = product.pictures[oldPictureIndex]
          isImgExists = oldPicture.normal.url !== url
        }
      }

      logger.info(`${product._id} ${JSON.stringify(product.pictures)} exists: ${isImgExists} index: ${index} (${i}) ${url}`)
      if (!isImgExists) {
        promisesImgs.push(tryImageUpload(storeId, auth, url, product, i))
      }
    }
  })
  return Promise.all(promisesImgs).then((images) => {
    const body = {
      pictures: product.pictures
    }
    if (Array.isArray(product.variations) && product.variations.length) {
      product.variations.forEach(variation => {
        if (variation.picture_id || variation.picture_id === 0) {
          const variationImage = images[variation.picture_id]
          if (variationImage._id) {
            variation.picture_id = variationImage._id
          } else {
            delete variation.picture_id
          }
        }
      })
      body.variations = product.variations
    }
    logger.info(`Update product ${product._id} => ${JSON.stringify(body)}`)
    return updateProductById(appSdk, storeId, auth, product._id, body)
  })
}

module.exports = {
  saveImagesProduct,
  getAppSdk,
  getProductById
}