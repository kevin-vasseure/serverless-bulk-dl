const app = require('../../app.js')
const event = require('../../../events/api_event.json')
const wrong_event = require('../../../events/api_event_bad_payload.json')
const payload = require('../../../events/zip_master_payload.json')

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
describe('Test api handler', function () {
    it('verifies successful response', async () => {
        const result = await app.apiHandler(event, context)
        expect(result.statusCode).toEqual(200)
        let response = JSON.parse(result.body)
        expect(response.message).toEqual("expected bulk download size: 1.95 KiB")
    })
    it('verifies wrong payload', async () => {
        const result = await app.apiHandler(wrong_event, context)
        expect(result.statusCode).toEqual(400)
        JSON.parse(result.body)
    })
})

describe('Test zip master handler', function () {
    it('verifies it starts', async () => {
        await app.zipMasterHandler(payload)
    })
})

describe('Test zip handler', function () {
    it('verifies it starts', async () => {
        await app.zipHandler(payload)
    })
})

