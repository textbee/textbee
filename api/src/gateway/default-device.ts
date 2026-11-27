import { Model, Types } from 'mongoose'
import { DeviceDocument } from './schemas/device.schema'

// The writes of the set-default route: the account's other defaults are
// cleared, then this device is set
export async function makeDefaultDevice(
  deviceModel: Model<DeviceDocument>,
  device: { _id: Types.ObjectId | string; user: any },
  deviceId: Types.ObjectId | string = device._id,
) {
  await deviceModel.updateMany(
    { user: device.user, _id: { $ne: device._id }, isDefault: true },
    { $set: { isDefault: false } },
  )
  return await deviceModel.findByIdAndUpdate(
    deviceId,
    { $set: { isDefault: true } },
    { returnDocument: 'after' },
  )
}
