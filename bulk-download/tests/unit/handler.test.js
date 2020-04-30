const app = require('../../app.js')
const eventBadSchema = require('../../../stubs/api_event_bad_schema.json')
const eventBadJson = require('../../../stubs/api_event_bad_json.json')
const payloadRaw = require('../../../stubs/payload_raw.json')
const payloadEnriched = require('../../../stubs/payload_enriched.json')
const payloadEnrichedOneAsset = require('../../../stubs/payload_enriched_one_asset.json')
const event = require('../../../stubs/api_event.json')

jest.mock('axios', () => {
    const response = {headers: {'content-length': '1000'}}
    return jest.fn().mockResolvedValue(response)
})
jest.mock('aws-sdk', () => {
    return {
        S3: jest.fn(() => ({
            upload: jest.fn(() => ({
                on: jest.fn(),
                promise: jest.fn()
            }))
        })),
        Lambda: jest.fn(() => ({
            invoke: jest.fn(() => ({
                promise: jest.fn()
            }))
        }))
    };
});
jest.mock('archiver', () => {
    return jest.fn(() => ({
        on: jest.fn(),
        pipe: jest.fn(),
        finalize: jest.fn(),
        append: jest.fn()
    }))
})

let context
describe('api handler validation', function () {
    it('verifies that payload with wrong schema is handled', async () => {
        const result = await app.apiHandler(eventBadSchema, context)
        expect(result.statusCode).toEqual(400)
        const responseBody = JSON.parse(result.body);
        expect(responseBody.message[0].message).toContain('requires property')
    })
    it('verifies that payload with incorrect json is handled', async () => {
        const result = await app.apiHandler(eventBadJson, context)
        expect(result.statusCode).toEqual(400)
        const responseBody = JSON.parse(result.body);
        expect(responseBody.message).toContain('Unexpected token')
    })
})

describe('enrich payload function test', function () {
    it('verifies that payload is enriched with asset size and total size', async () => {
        const enrichedPayload = await app.enrichPayload(payloadRaw)
        expect(enrichedPayload.assets[0].size).toEqual(1000)
        expect(enrichedPayload.totalSize).toEqual(4000)
    })
})

describe('tests on the function that triggers zips', function () {
    it('verifies how it splits bulk dls', async () => {
        let payload = await app.triggerZipLambdas(payloadEnriched)
        expect(payload.zipList.length).toEqual(2)
        expect(payload.zipList[0].zipName).toMatch(/.*-1\.zip$/)
        expect(payload.zipList[0].assets.length).toEqual(3)
        expect(payload.zipList[1].zipName).toMatch(/.*-2\.zip$/)
        expect(payload.zipList[1].assets.length).toEqual(1)
    })
    it('verifies it doesnt split when only one asset', async () => {
        let payload = await app.triggerZipLambdas(payloadEnrichedOneAsset)
        expect(payload.zipList.length).toEqual(1)
        expect(payload.zipList[0].zipName).toMatch(/.*(?<!-\d)\.zip$/)
    })
})

describe('api handler response', function () {
    it('verifies that payload with wrong schema is handled', async () => {
        const result = await app.apiHandler(event, context)
        expect(result.statusCode).toEqual(200)
        const responseBody = JSON.parse(result.body);
        expect(responseBody.message.totalSize).toEqual("1.95 KiB")
        expect(responseBody.message.zipList.length).toEqual(1)
    })
})

describe('Test zip handler', function () {
    it('verifies it starts', async () => {
        await app.zipHandler(payloadEnriched)
    })
})

