const app = require('../../app.js')
const eventBadSchema = require('../../../stubs/api_event_bad_schema.json')
const eventBadJson = require('../../../stubs/api_event_bad_json.json')
const payloadRaw = require('../../../stubs/payload_raw.json')
const payloadEnriched = require('../../../stubs/payload_enriched.json')
const payloadSplit = require('../../../stubs/payload_split.json')
const payloadEnrichedOneAsset = require('../../../stubs/payload_enriched_one_asset.json')
const payloadSplitOneAsset = require('../../../stubs/payload_split_one_asset.json')
const mockListObjectsResponse = require('../../../stubs/list_objects_stub.json')
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
            })),
            listObjects: jest.fn(() => ({
                promise: jest.fn(() => Promise.resolve(mockListObjectsResponse))
            }))
        })),
        Lambda: jest.fn(() => ({
            invoke: jest.fn(() => ({
                promise: jest.fn()
            }))
        })),
        StepFunctions: jest.fn(() => ({
            startExecution: jest.fn(() => ({
                promise: jest.fn(() => Promise.resolve({executionArn: "myarn", startDate: "not sure"}))
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
process.env.BD_ARCHIVE_SIZE = "1000000000"

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
    it('verifies that payload with wrong schema is handled', async () => {
        const result = await app.apiHandler(event, context)
        expect(result.statusCode).toEqual(200)
        const responseBody = JSON.parse(result.body);
        expect(responseBody.message.totalSize).toEqual("1.95 KiB")
        expect(responseBody.message.stepFunction.executionArn).toEqual("myarn")
    })
})

describe('enrich payload function test', function () {
    it('verifies that payload is enriched with asset size and total size', async () => {
        const enrichedPayload = await app.fetchAssetSize(payloadRaw)
        expect(enrichedPayload.assets[0].size).toEqual(1000)
        expect(enrichedPayload.totalSize).toEqual(4000)
    })
})

describe('split asset function test', function () {
    it('verifies how it splits bulk dls', async () => {
        let payload = await app.splitPayload(payloadEnriched)
        expect(payload).toEqual(payloadSplit)
    })
    it('verifies it doesnt split when only one asset', async () => {
        let payload = await app.splitPayload(payloadEnrichedOneAsset)
        expect(payload).toEqual(payloadSplitOneAsset)
    })
})

describe('check if zips exists', function () {
    it('check if the zips for this bulk download already exits.', async () => {
        const payload = await app.checkIfZipsExist(payloadSplit)
        expect(payload.zipsExist).toEqual(1)
    })
})
