import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillsService } from './skills.service';

describe('SkillsService.get — detail gated per register', () => {
  const skill = { id: 's1', organizationId: 'org1', name: 'Soudure', _count: { requirements: 1, evaluations: 1 } };
  const prisma = {
    skill: { findFirst: jest.fn() },
    jobDescription: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'jd1', reference: 'FP-01', version: '1', jobTitle: 'Soudeur', status: 'PUBLISHED', skillRequirements: [{ requiredLevel: 4 }] },
      ]),
    },
    competencyEvaluation: { findMany: jest.fn().mockResolvedValue([{ id: 'ce1', gap: -1 }]) },
  };
  const service = new SkillsService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.skill.findFirst.mockResolvedValue(skill);
  });

  it('returns job descriptions (flattened required level) and evaluations to a full reader', async () => {
    const res = await service.get(
      'org1',
      's1',
      new Set(['skills:read', 'job-descriptions:read', 'competency-evaluations:read', 'employees:read']),
    );
    expect(res.jobDescriptions).toEqual([expect.objectContaining({ id: 'jd1', requiredLevel: 4 })]);
    expect(res.evaluations).toHaveLength(1);
    expect(prisma.jobDescription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org1', deletedAt: null }) }),
    );
  });

  it('withholds registers the caller cannot read (null, not queried)', async () => {
    const res = await service.get('org1', 's1', new Set(['skills:read', 'competency-evaluations:read']));
    expect(res.jobDescriptions).toBeNull();
    expect(res.evaluations).toBeNull(); // employees:read missing
    expect(prisma.jobDescription.findMany).not.toHaveBeenCalled();
    expect(prisma.competencyEvaluation.findMany).not.toHaveBeenCalled();
  });

  it('404s on a skill of another organization or deleted', async () => {
    prisma.skill.findFirst.mockResolvedValue(null);
    await expect(service.get('org1', 'other', new Set(['skills:read']))).rejects.toBeInstanceOf(NotFoundException);
  });
});
