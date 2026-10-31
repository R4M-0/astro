import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ActivityService } from '../../core/activity/activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SurveysService } from './surveys.service';

describe('SurveysService — respondent identity & duplicate guard', () => {
  let service: SurveysService;

  const question = {
    id: 'q1',
    type: 'YES_NO',
    label: 'Satisfait ?',
    required: true,
    scaleMin: 1,
    scaleMax: 5,
    options: [],
  };
  const survey = {
    id: 's1',
    organizationId: 'org1',
    status: 'PUBLISHED',
    anonymous: false,
    allowMultipleResponses: false,
    closesAt: null as Date | null,
    publicToken: 'tok',
    questions: [question],
  };
  const prismaMock = {
    hrSurvey: { findFirst: jest.fn() },
    hrSurveyResponse: { findFirst: jest.fn(), create: jest.fn() },
    employee: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.hrSurvey.findFirst.mockResolvedValue(survey);
    prismaMock.hrSurveyResponse.findFirst.mockResolvedValue(null);
    prismaMock.hrSurveyResponse.create.mockResolvedValue({ id: 'r1' });
    prismaMock.employee.findFirst.mockResolvedValue({ id: 'emp1', firstName: 'Alice', lastName: 'Martin' });
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Alice', lastName: 'M.', email: 'Alice@Corp.test' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SurveysService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ActivityService, useValue: { record: jest.fn() } },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'APP_URL' ? 'https://app.test' : 'secret') } },
      ],
    }).compile();
    service = moduleRef.get(SurveysService);
  });

  const answers = [{ questionId: 'q1', boolValue: true }];

  it('public answer never attributes an Employee from the typed e-mail', async () => {
    await service.publicRespond('tok', {
      respondentKey: 'browser-1',
      respondentName: 'Bob Usurpateur',
      respondentEmail: 'alice@corp.test',
      answers,
    });
    expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
    const data = prismaMock.hrSurveyResponse.create.mock.calls[0][0].data;
    expect(data.employeeId).toBeNull();
    expect(data.verified).toBe(false);
    expect(data.respondentEmail).toBe('alice@corp.test');
  });

  it('public duplicate check uses the browser key only (no e-mail lock-out / oracle)', async () => {
    await service.publicRespond('tok', {
      respondentKey: 'browser-1',
      respondentName: 'X',
      respondentEmail: 'alice@corp.test',
      answers,
    });
    const where = prismaMock.hrSurveyResponse.findFirst.mock.calls[0][0].where;
    expect(Object.keys(where).sort()).toEqual(['respondentKey', 'surveyId']);
    expect(where.OR).toBeUndefined();
  });

  it('public duplicate on the same browser key → 409', async () => {
    prismaMock.hrSurveyResponse.findFirst.mockResolvedValue({ id: 'old' });
    await expect(
      service.publicRespond('tok', { respondentKey: 'browser-1', respondentName: 'X', answers }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('signed-in answer is verified and attributed to the member’s own Employee', async () => {
    await service.memberRespond('HR', 'org1', 'u1', 's1', { answers });
    expect(prismaMock.employee.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: 'org1', userId: 'u1' });
    const data = prismaMock.hrSurveyResponse.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ employeeId: 'emp1', verified: true, respondentEmail: 'alice@corp.test' });
    expect(data.respondentKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signed-in answer on an anonymous survey stores no identity', async () => {
    prismaMock.hrSurvey.findFirst.mockResolvedValue({ ...survey, anonymous: true });
    await service.memberRespond('HR', 'org1', 'u1', 's1', { answers });
    const data = prismaMock.hrSurveyResponse.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ employeeId: null, respondentName: null, respondentEmail: null, verified: false });
    expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
  });

  it('share token is never returned; URL only to managers', async () => {
    prismaMock.hrSurvey.findFirst.mockResolvedValue({ ...survey, questions: [], _count: { responses: 0 } });
    const reader = await service.get('HR', 'org1', 's1', false);
    const manager = await service.get('HR', 'org1', 's1', true);
    expect(reader).not.toHaveProperty('publicToken');
    expect(reader.publicUrl).toBeNull();
    expect(manager).not.toHaveProperty('publicToken');
    expect(manager.publicUrl).toBe('https://app.test/e/tok');
  });
});
