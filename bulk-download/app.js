const archiver = require('archiver')
const AWS = require('aws-sdk')
const axios = require('axios')
const stream = require('stream')
const payloadSchema = require('./event.schema.json')
const validate = require('jsonschema').validate
const crypto = require('crypto')
const fileSize = require('file-size')

/**
 * Check that the request body format is correct and return error message if not
 * Otherwise triggers the zip master function
 * @param event payload
 * @param context
 * @returns {Promise<{body: string, statusCode: number}|*>}
 */
async function apiHandler(event, context) {
    let response
    let payload
    let jsonSchemaErrors = []

    console.log(`received event ${event}`)
    try {
        payload = JSON.parse(event.body)
        let validation = validate(payload, payloadSchema)
        jsonSchemaErrors = validation.errors
    } catch (error) {
        console.warn("invalid payload : " + error.message)
        response = {
            'statusCode': 400,
            'body': JSON.stringify({
                message: error.message,
            })
        }
    }

    if (!response && jsonSchemaErrors.length > 0) {
        console.warn("invalid payload : " + JSON.stringify(jsonSchemaErrors))
        response = {
            'statusCode': 400,
            'body': JSON.stringify({
                message: jsonSchemaErrors,
            })
        }
    }

    if (!response) {
        try {
            payload = await enrichPayload(payload)
            payload = await triggerZipLambdas(payload)

            response = {
                'statusCode': 200,
                'body': JSON.stringify({
                    message: {
                        totalSize: fileSize(payload.totalSize).human(),
                        zipList: payload.zipList.map((zip) => {
                            return {
                                assets: zip.assets,
                                zipName: zip.zipName,
                                size: fileSize(zip.size).human()
                            }
                        })
                    }
                })
            }
        } catch (err) {
            console.log(err)
            return err
        }
    }
    return response
}

/**
 * Will enrich the payload with the size of the assets
 * through HEAD requests run in parrallel
 * @param payload
 * @returns {Promise<void>}
 */
async function enrichPayload(payload) {
    const requests = await Promise.all(payload.assets.map(asset => axios({url: asset.url, method: "HEAD"})))
    const sizes = requests.map(response => parseInt(response.headers['content-length'] || 0))
    payload.totalSize = sizes.reduce((a, b) => a + b, 0)
    payload.assets = payload.assets.map((asset, index) => {
        asset.size = sizes[index]
        return asset
    })
    return payload
}

/**
 * Check the assets size, split downloads into different archives
 * @param payload
 * @returns {Promise<[]>}
 */
async function triggerZipLambdas(payload) {
    console.log("received event " + JSON.stringify(payload, null, 2))

    const maxSize = process.env.ARCHIVE_SIZE || 1000000000
    const lambda = new AWS.Lambda()
    const invocationList = []

    //make a hash id out of filenames and sizes
    const data = payload.assets.reduce((a, b) => a.name + a.size + b.name + b.size, {name: "", size: ""})
    const hashID = "download_" + crypto.createHash('md5').update(data).digest("hex")

    let sizeCounter = 0
    let assetsAccumulator = []
    let zipCount = 1
    let zipList = []

    //loop on assets url
    payload.assets.forEach((asset, index) => {
        sizeCounter += asset.size
        assetsAccumulator.push(asset)
        if (sizeCounter > maxSize || (index + 1 === payload.assets.length)) { //until we reach our size threshold or end of array
            const zipName = (sizeCounter < payload.totalSize || zipCount > 1) ? hashID + "-" + zipCount++ + ".zip" : hashID + ".zip"
            console.log("calling zip function " + process.env.ZIP_FUNCTION + " => " + JSON.stringify(assetsAccumulator))
            console.log("estimated size " + fileSize(sizeCounter).human())
            //send a sublist of assets to a zip lambda
            const sublist = {assets: assetsAccumulator, zipName: zipName, size: sizeCounter}
            zipList.push(sublist)
            //call zip lambda
            let invocation = lambda.invoke({
                FunctionName: process.env.ZIP_FUNCTION,
                InvocationType: 'Event',
                Payload: JSON.stringify(sublist)
            }).promise()
            invocationList.push(invocation)
            //reset asset list and size counter
            assetsAccumulator = []
            sizeCounter = 0
        }
    })

    await Promise.all(invocationList)
    payload.zipList = zipList
    return Promise.resolve(payload)
}

/**
 * streams binary data from URL
 * pipe it into archiver then directly to s3
 *
 * inspired from here https://dev.to/lineup-ninja/zip-files-on-s3-with-aws-lambda-and-node-1nm1
 *
 * @param payload
 * @returns file location
 */
async function zipHandler(payload) {
    console.log("received event " + JSON.stringify(payload))

    const s3 = new AWS.S3()
    const streamPassThrough = new stream.PassThrough()

    const s3Upload = s3.upload({
        Body: streamPassThrough,
        Bucket: process.env.BULK_DOWNLOAD_ZIP_BUCKET,
        ContentType: 'application/zip',
        Key: payload.zipName,
    })
    s3Upload.on('httpUploadProgress', (progress) => {
        console.log(progress)
    })

    const archive = archiver("zip", {})
    archive.on('error', error => {
        throw error
    })
    archive.on('end', () => {
        console.log(`archive ${payload.zipName} end reading`)
    })
    archive.on('finish', () => {
        console.log(`archive ${payload.zipName} finish writing`)
    })
    archive.pipe(streamPassThrough)
    for (let asset of payload.assets) {
        try {
            let request = await axios({url: asset.url, responseType: 'stream'})
            archive.append(request.data, {name: asset.name})
        } catch (e) {
            throw e
        }
    }
    archive.finalize()
    return s3Upload.promise()
}

module.exports = {
    apiHandler: apiHandler,
    enrichPayload: enrichPayload,
    triggerZipLambdas: triggerZipLambdas,
    zipHandler: zipHandler
}
