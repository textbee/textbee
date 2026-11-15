import * as mongoose from 'mongoose'
import { DeviceSchema } from './schemas/device.schema'
import { mergeSimNumbers } from './sim-numbers'

const SLOT_ERROR =
  'simNumbers needs one entry per SIM slot, with slotIndex from 0 to 7.'
const PHONE_ERROR =
  'Enter the phone number with digits only, for example +15555550123.'

describe('mergeSimNumbers validation', () => {
  it.each([
    ['not a list', { slotIndex: 0, phoneNumber: '+15555550123' }],
    ['a missing slotIndex', [{ phoneNumber: '+15555550123' }]],
    ['a slot above 7', [{ slotIndex: 8, phoneNumber: '+15555550123' }]],
    ['a negative slot', [{ slotIndex: -1, phoneNumber: '+15555550123' }]],
    ['a fractional slot', [{ slotIndex: 0.5, phoneNumber: '+15555550123' }]],
    ['a slot as a string', [{ slotIndex: '0', phoneNumber: '+15555550123' }]],
    ['an entry that is not an object', ['+15555550123']],
    [
      'the same slot twice',
      [
        { slotIndex: 1, phoneNumber: '+15555550123' },
        { slotIndex: 1, phoneNumber: '' },
      ],
    ],
  ])('rejects %s', (_name, input) => {
    expect(mergeSimNumbers([], input)).toEqual({ ok: false, error: SLOT_ERROR })
  })

  it.each([
    ['letters', '+1555CALLNOW'],
    ['too few digits', '12'],
    ['too many digits', '+1234567890123456'],
    ['a plus in the middle', '1+5555550123'],
    ['two pluses', '++15555550123'],
    ['only separators and a plus', '+ - .'],
    ['a number value', 15555550123],
    ['a missing number', undefined],
  ])('rejects a phone number with %s', (_name, phoneNumber) => {
    expect(mergeSimNumbers([], [{ slotIndex: 0, phoneNumber }])).toEqual({
      ok: false,
      error: PHONE_ERROR,
    })
  })

  it('checks every slot before any phone number', () => {
    expect(
      mergeSimNumbers(
        [],
        [
          { slotIndex: 0, phoneNumber: 'bad' },
          { slotIndex: 9, phoneNumber: '+15555550123' },
        ],
      ),
    ).toEqual({ ok: false, error: SLOT_ERROR })
  })
})

describe('mergeSimNumbers values', () => {
  it('removes spaces, dashes, dots and brackets before storing', () => {
    expect(
      mergeSimNumbers(
        [],
        [
          { slotIndex: 0, phoneNumber: ' +1 (555) 555-0123 ' },
          { slotIndex: 1, phoneNumber: '555.555.0177' },
          { slotIndex: 2, phoneNumber: '[555] 0100' },
        ],
      ),
    ).toEqual({
      ok: true,
      simNumbers: [
        { slotIndex: 0, phoneNumber: '+15555550123' },
        { slotIndex: 1, phoneNumber: '5555550177' },
        { slotIndex: 2, phoneNumber: '5550100' },
      ],
    })
  })

  it('accepts 3 and 15 digits', () => {
    expect(
      mergeSimNumbers(
        [],
        [
          { slotIndex: 0, phoneNumber: '123' },
          { slotIndex: 1, phoneNumber: '+123456789012345' },
        ],
      ),
    ).toMatchObject({ ok: true })
  })

  it('replaces the slots in the request and keeps the others', () => {
    const stored = [
      { slotIndex: 0, phoneNumber: '+15555550123' },
      { slotIndex: 1, phoneNumber: '+15555550177' },
    ]
    expect(
      mergeSimNumbers(stored, [{ slotIndex: 1, phoneNumber: '+15555550199' }]),
    ).toEqual({
      ok: true,
      simNumbers: [
        { slotIndex: 0, phoneNumber: '+15555550123' },
        { slotIndex: 1, phoneNumber: '+15555550199' },
      ],
    })
  })

  it('removes a slot sent with an empty phone number', () => {
    const stored = [
      { slotIndex: 0, phoneNumber: '+15555550123' },
      { slotIndex: 1, phoneNumber: '+15555550177' },
    ]
    expect(
      mergeSimNumbers(stored, [{ slotIndex: 0, phoneNumber: ' ' }]),
    ).toEqual({
      ok: true,
      simNumbers: [{ slotIndex: 1, phoneNumber: '+15555550177' }],
    })
    expect(
      mergeSimNumbers(stored, [
        { slotIndex: 0, phoneNumber: '' },
        { slotIndex: 1, phoneNumber: '' },
      ]),
    ).toEqual({ ok: true, simNumbers: [] })
  })

  it('stores entries in slot order', () => {
    expect(
      mergeSimNumbers(
        [{ slotIndex: 1, phoneNumber: '+15555550177' }],
        [{ slotIndex: 0, phoneNumber: '+15555550123' }],
      ),
    ).toEqual({
      ok: true,
      simNumbers: [
        { slotIndex: 0, phoneNumber: '+15555550123' },
        { slotIndex: 1, phoneNumber: '+15555550177' },
      ],
    })
  })

  it('treats a device without numbers as empty', () => {
    expect(mergeSimNumbers(undefined, [])).toEqual({ ok: true, simNumbers: [] })
  })
})

describe('DeviceSchema simNumbers', () => {
  const DeviceModel = mongoose.model('DeviceSchemaSimNumbersSpec', DeviceSchema)

  it('is absent until set', () => {
    expect(new DeviceModel({}).toObject().simNumbers).toBeUndefined()
  })

  it('stores entries without an id of their own', () => {
    const device = new DeviceModel({
      simNumbers: [{ slotIndex: 1, phoneNumber: '+15555550177' }],
    })
    expect(device.toObject().simNumbers).toEqual([
      { slotIndex: 1, phoneNumber: '+15555550177' },
    ])
  })
})
