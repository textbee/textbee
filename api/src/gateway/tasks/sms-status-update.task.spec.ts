import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EXPIRE_CHUNK_SIZE, SmsStatusUpdateTask } from './sms-status-update.task';
import { SMS } from '../schemas/sms.schema';
import { SMSBatch } from '../schemas/sms-batch.schema';
import { SmsBatchStatusService } from '../sms-batch-status.service';

describe('SmsStatusUpdateTask', () => {
  let task: SmsStatusUpdateTask;
  let findResults: Record<string, any[][]>;

  const smsModel = {
    find: jest.fn(),
    updateMany: jest.fn(),
  };
  const smsBatchModel = {
    updateMany: jest.fn(),
  };
  const batchStatus = {
    refresh: jest.fn(),
    recomputeStaleProcessing: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    findResults = { pending: [], dispatched: [] };
    smsModel.find.mockImplementation((filter) => ({
      limit: () => ({
        lean: async () => findResults[filter.status].shift() ?? [],
      }),
    }));
    smsModel.updateMany.mockImplementation(async (filter) => ({
      modifiedCount: filter._id.$in.length,
    }));
    smsBatchModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
    batchStatus.refresh.mockResolvedValue(undefined);
    batchStatus.recomputeStaleProcessing.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsStatusUpdateTask,
        { provide: getModelToken(SMS.name), useValue: smsModel },
        { provide: getModelToken(SMSBatch.name), useValue: smsBatchModel },
        { provide: SmsBatchStatusService, useValue: batchStatus },
      ],
    }).compile();

    task = module.get<SmsStatusUpdateTask>(SmsStatusUpdateTask);
  });

  it('should be defined', () => {
    expect(task).toBeDefined();
  });

  describe('handlePendingSmsTimeout', () => {
    it('marks stale pending messages unknown and refreshes their batches', async () => {
      findResults.pending = [
        [
          { _id: 'sms-1', smsBatch: 'batch-1' },
          { _id: 'sms-2', smsBatch: 'batch-2' },
        ],
      ];

      await task.handlePendingSmsTimeout();

      const pendingFilter = smsModel.find.mock.calls[0][0];
      const cutoff = pendingFilter.requestedAt.$lt as Date;
      expect(pendingFilter.status).toBe('pending');
      // Paced messages whose wave is not yet due must be left alone
      expect(pendingFilter.$or).toEqual([
        { dispatchDueAt: { $exists: false } },
        { dispatchDueAt: { $lt: cutoff } },
      ]);
      expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(20 * 60 * 1000 - 1000);

      // The update re-checks the filter so a fresh report is not overwritten
      expect(smsModel.updateMany).toHaveBeenCalledWith(
        { ...pendingFilter, _id: { $in: ['sms-1', 'sms-2'] } },
        {
          $set: {
            status: 'unknown',
            errorMessage: 'Status update timeout - no response received after 20 minutes',
          },
        },
      );
      expect(batchStatus.refresh).toHaveBeenCalledWith(['batch-1', 'batch-2']);
    });

    it('marks stale dispatched messages unknown and refreshes their batches', async () => {
      findResults.dispatched = [[{ _id: 'sms-3', smsBatch: 'batch-3' }]];

      await task.handlePendingSmsTimeout();

      expect(smsModel.updateMany).toHaveBeenCalledWith(
        {
          status: 'dispatched',
          dispatchedAt: expect.any(Object),
          _id: { $in: ['sms-3'] },
        },
        {
          $set: {
            status: 'unknown',
            errorMessage: 'Status update timeout - no response from device after dispatch',
          },
        },
      );
      expect(batchStatus.refresh).toHaveBeenCalledWith(['batch-3']);
    });

    it('keeps going in chunks until a short page', async () => {
      const full = Array.from({ length: EXPIRE_CHUNK_SIZE }, (_, i) => ({
        _id: `sms-${i}`,
        smsBatch: 'batch-1',
      }));
      findResults.dispatched = [full, [{ _id: 'last', smsBatch: 'batch-2' }]];

      await task.handlePendingSmsTimeout();

      const dispatchedFinds = smsModel.find.mock.calls.filter(
        ([filter]) => filter.status === 'dispatched',
      );
      expect(dispatchedFinds).toHaveLength(2);
      expect(batchStatus.refresh).toHaveBeenCalledWith(['batch-2']);
    });

    it('does not write when nothing is stale', async () => {
      await task.handlePendingSmsTimeout();

      expect(smsModel.updateMany).not.toHaveBeenCalled();
      expect(batchStatus.refresh).not.toHaveBeenCalled();
    });

    it('expires pending batches and sweeps stale processing ones', async () => {
      await task.handlePendingSmsTimeout();

      expect(smsBatchModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          createdAt: expect.any(Object),
        }),
        {
          $set: {
            status: 'unknown',
            error: 'Status update timeout - no response received after 20 minutes',
          },
        },
      );
      expect(batchStatus.recomputeStaleProcessing).toHaveBeenCalled();
    });
  });
});
