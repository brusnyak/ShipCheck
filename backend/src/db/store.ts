import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  IssueCategory,
  IssueSeverity,
  LaunchGrade,
  ProjectRecord,
  ScanIssueInput,
  ScanIssueRecord,
  ScanMode,
  ScanRunRecord,
  ScanStatus,
  ScanSummary,
  TriggerType,
} from '../types.ts';

export interface CreateScanInput {
  targetUrl: string;
  triggerType?: TriggerType;
  projectId?: string | null;
  ownerId?: string | null;
}

export interface UpdateScanInput {
  status?: ScanStatus;
  scanMode?: ScanMode;
  score?: number | null;
  grade?: LaunchGrade | null;
  summary?: ScanSummary | null;
  pagesScanned?: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface CreateProjectInput {
  id?: string;
  ownerId: string;
  name: string;
  targetUrl: string;
  webhookToken?: string;
}

export interface ShipCheckStore {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  syncProjects(ownerId: string, projects: CreateProjectInput[]): Promise<ProjectRecord[]>;
  listProjectsByOwner(ownerId: string): Promise<ProjectRecord[]>;
  getProjectById(id: string): Promise<ProjectRecord | null>;
  getProjectByWebhookToken(token: string): Promise<ProjectRecord | null>;
  rotateProjectWebhookToken(id: string, ownerId: string): Promise<ProjectRecord | null>;
  deleteProject(id: string, ownerId: string): Promise<boolean>;
  createScanRun(input: CreateScanInput): Promise<ScanRunRecord>;
  updateScanRun(id: string, patch: UpdateScanInput): Promise<ScanRunRecord | null>;
  addScanIssues(scanRunId: string, issues: ScanIssueInput[]): Promise<ScanIssueRecord[]>;
  getScanByIdOrSlug(idOrSlug: string): Promise<ScanRunRecord | null>;
  listRecentScans(limit?: number): Promise<ScanRunRecord[]>;
  listScansByProject(projectId: string, limit?: number): Promise<ScanRunRecord[]>;
  clearForTesting(): Promise<void>;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateSlug(): string {
  return crypto.randomBytes(5).toString('hex');
}

export function generateWebhookToken(): string {
  return `sc_wh_${crypto.randomBytes(18).toString('hex')}`;
}

interface PersistedSnapshot {
  projects: ProjectRecord[];
  scanRuns: ScanRunRecord[];
  scanIssues: ScanIssueRecord[];
}

class LocalStore implements ShipCheckStore {
  private projects = new Map<string, ProjectRecord>();
  private scanRuns = new Map<string, ScanRunRecord>();
  private scanIssues = new Map<string, ScanIssueRecord[]>();
  private readonly persistPath: string | null;

  constructor(persistPath: string | null) {
    this.persistPath = persistPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedSnapshot;
        for (const p of parsed.projects ?? []) {
          this.projects.set(p.id, p);
        }
        for (const r of parsed.scanRuns ?? []) {
          this.scanRuns.set(r.id, r);
        }
        for (const issue of parsed.scanIssues ?? []) {
          const list = this.scanIssues.get(issue.scanRunId) ?? [];
          list.push(issue);
          this.scanIssues.set(issue.scanRunId, list);
        }
      }
    } catch (err) {
      console.warn('Could not load local ShipCheck store snapshot:', err);
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const allIssues: ScanIssueRecord[] = [];
      for (const issues of this.scanIssues.values()) {
        allIssues.push(...issues);
      }
      const snapshot: PersistedSnapshot = {
        projects: Array.from(this.projects.values()),
        scanRuns: Array.from(this.scanRuns.values()).slice(-200),
        scanIssues: allIssues.slice(-2000),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Could not persist ShipCheck store snapshot:', err);
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: input.id || generateId('proj'),
      ownerId: input.ownerId,
      name: input.name,
      targetUrl: input.targetUrl,
      webhookToken: input.webhookToken || generateWebhookToken(),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(record.id, record);
    this.saveToDisk();
    return { ...record, recentScans: [] };
  }

  async syncProjects(ownerId: string, projects: CreateProjectInput[]): Promise<ProjectRecord[]> {
    const now = new Date().toISOString();
    for (const p of projects) {
      const existing = p.id ? this.projects.get(p.id) : undefined;
      if (existing && existing.ownerId !== ownerId) {
        continue;
      }
      const id = p.id || generateId('proj');
      const record: ProjectRecord = {
        id,
        ownerId,
        name: p.name,
        targetUrl: p.targetUrl,
        webhookToken: p.webhookToken || existing?.webhookToken || generateWebhookToken(),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      this.projects.set(id, record);
    }
    this.saveToDisk();
    return this.listProjectsByOwner(ownerId);
  }

  async listProjectsByOwner(ownerId: string): Promise<ProjectRecord[]> {
    const list = Array.from(this.projects.values())
      .filter((p) => p.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return Promise.all(
      list.map(async (project) => ({
        ...project,
        recentScans: await this.listScansByProject(project.id, 5),
      }))
    );
  }

  async getProjectById(id: string): Promise<ProjectRecord | null> {
    return this.projects.get(id) ?? null;
  }

  async getProjectByWebhookToken(token: string): Promise<ProjectRecord | null> {
    for (const project of this.projects.values()) {
      if (project.webhookToken === token) {
        return project;
      }
    }
    return null;
  }

  async rotateProjectWebhookToken(id: string, ownerId: string): Promise<ProjectRecord | null> {
    const existing = this.projects.get(id);
    if (!existing || existing.ownerId !== ownerId) {
      return null;
    }
    const updated: ProjectRecord = {
      ...existing,
      webhookToken: generateWebhookToken(),
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(id, updated);
    this.saveToDisk();
    return {
      ...updated,
      recentScans: await this.listScansByProject(id, 5),
    };
  }

  async deleteProject(id: string, ownerId: string): Promise<boolean> {
    const existing = this.projects.get(id);
    if (!existing || existing.ownerId !== ownerId) {
      return false;
    }
    this.projects.delete(id);
    this.saveToDisk();
    return true;
  }

  async createScanRun(input: CreateScanInput): Promise<ScanRunRecord> {
    const now = new Date().toISOString();
    const record: ScanRunRecord = {
      id: generateId('scan'),
      shareSlug: generateSlug(),
      ownerId: input.ownerId ?? null,
      targetUrl: input.targetUrl,
      status: ScanStatus.QUEUED,
      triggerType: input.triggerType ?? TriggerType.MANUAL,
      scanMode: ScanMode.PLAYWRIGHT,
      score: null,
      grade: null,
      summary: null,
      pagesScanned: 0,
      durationMs: null,
      errorMessage: null,
      projectId: input.projectId ?? null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.scanRuns.set(record.id, record);
    this.scanIssues.set(record.id, []);
    this.saveToDisk();
    return { ...record, issues: [] };
  }

  async updateScanRun(id: string, patch: UpdateScanInput): Promise<ScanRunRecord | null> {
    const existing = this.scanRuns.get(id);
    if (!existing) return null;
    const updated: ScanRunRecord = {
      ...existing,
      ...patch,
    };
    this.scanRuns.set(id, updated);
    this.saveToDisk();
    return {
      ...updated,
      issues: this.scanIssues.get(id) ?? [],
    };
  }

  async addScanIssues(scanRunId: string, issues: ScanIssueInput[]): Promise<ScanIssueRecord[]> {
    const now = new Date().toISOString();
    const existing = this.scanIssues.get(scanRunId) ?? [];
    const created: ScanIssueRecord[] = issues.map((issue) => ({
      ...issue,
      id: generateId('iss'),
      scanRunId,
      createdAt: now,
    }));
    const merged = [...existing, ...created];
    this.scanIssues.set(scanRunId, merged);
    this.saveToDisk();
    return merged;
  }

  async getScanByIdOrSlug(idOrSlug: string): Promise<ScanRunRecord | null> {
    const direct = this.scanRuns.get(idOrSlug);
    if (direct) {
      return {
        ...direct,
        issues: this.scanIssues.get(direct.id) ?? [],
      };
    }
    for (const run of this.scanRuns.values()) {
      if (run.shareSlug === idOrSlug) {
        return {
          ...run,
          issues: this.scanIssues.get(run.id) ?? [],
        };
      }
    }
    return null;
  }

  async listRecentScans(limit = 15): Promise<ScanRunRecord[]> {
    return Array.from(this.scanRuns.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listScansByProject(projectId: string, limit = 10): Promise<ScanRunRecord[]> {
    return Array.from(this.scanRuns.values())
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async clearForTesting(): Promise<void> {
    this.projects.clear();
    this.scanRuns.clear();
    this.scanIssues.clear();
  }
}

class PrismaStore implements ShipCheckStore {
  private prismaPromise: Promise<any> | null = null;

  private async getClient() {
    if (!this.prismaPromise) {
      this.prismaPromise = import('@prisma/client').then((mod: any) => {
        const PrismaClientCtor = mod.PrismaClient || mod.default?.PrismaClient;
        return new PrismaClientCtor();
      });
    }
    return this.prismaPromise;
  }

  private mapProject(p: any, recentScans?: any[]): ProjectRecord {
    return {
      id: p.id,
      ownerId: p.ownerId,
      name: p.name,
      targetUrl: p.targetUrl,
      webhookToken: p.webhookToken,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      recentScans: recentScans?.map((r) => this.mapScanRun(r)),
    };
  }

  private mapScanRun(r: any): ScanRunRecord {
    return {
      id: r.id,
      shareSlug: r.shareSlug,
      ownerId: r.ownerId ?? null,
      targetUrl: r.targetUrl,
      status: r.status as ScanStatus,
      triggerType: r.triggerType as TriggerType,
      scanMode: r.scanMode as ScanMode,
      score: r.score ?? null,
      grade: (r.grade as LaunchGrade) ?? null,
      summary: (r.summary as ScanSummary) ?? null,
      pagesScanned: r.pagesScanned,
      durationMs: r.durationMs ?? null,
      errorMessage: r.errorMessage ?? null,
      projectId: r.projectId ?? null,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      issues: r.issues?.map((i: any) => ({
        id: i.id,
        scanRunId: i.scanRunId,
        category: i.category as IssueCategory,
        severity: i.severity as IssueSeverity,
        title: i.title,
        description: i.description,
        remediation: i.remediation,
        pageUrl: i.pageUrl,
        evidence: (i.evidence as Record<string, unknown>) ?? {},
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const prisma = await this.getClient();
    const created = await prisma.project.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        ownerId: input.ownerId,
        name: input.name,
        targetUrl: input.targetUrl,
        webhookToken: input.webhookToken || generateWebhookToken(),
      },
    });
    return this.mapProject(created, []);
  }

  async syncProjects(ownerId: string, projects: CreateProjectInput[]): Promise<ProjectRecord[]> {
    const prisma = await this.getClient();
    for (const p of projects) {
      if (!p.id) continue;
      const existing = await prisma.project.findUnique({ where: { id: p.id } });
      if (existing && existing.ownerId !== ownerId) continue;
      if (existing) {
        await prisma.project.update({
          where: { id: p.id },
          data: {
            name: p.name,
            targetUrl: p.targetUrl,
            ...(p.webhookToken ? { webhookToken: p.webhookToken } : {}),
          },
        });
      } else {
        await prisma.project.create({
          data: {
            id: p.id,
            ownerId,
            name: p.name,
            targetUrl: p.targetUrl,
            webhookToken: p.webhookToken || generateWebhookToken(),
          },
        });
      }
    }
    return this.listProjectsByOwner(ownerId);
  }

  async listProjectsByOwner(ownerId: string): Promise<ProjectRecord[]> {
    const prisma = await this.getClient();
    const rows = await prisma.project.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        scanRuns: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    return rows.map((p: any) => this.mapProject(p, p.scanRuns));
  }

  async getProjectById(id: string): Promise<ProjectRecord | null> {
    const prisma = await this.getClient();
    const row = await prisma.project.findUnique({ where: { id } });
    return row ? this.mapProject(row) : null;
  }

  async getProjectByWebhookToken(token: string): Promise<ProjectRecord | null> {
    const prisma = await this.getClient();
    const row = await prisma.project.findUnique({ where: { webhookToken: token } });
    return row ? this.mapProject(row) : null;
  }

  async rotateProjectWebhookToken(id: string, ownerId: string): Promise<ProjectRecord | null> {
    const prisma = await this.getClient();
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== ownerId) return null;
    const updated = await prisma.project.update({
      where: { id },
      data: { webhookToken: generateWebhookToken() },
      include: {
        scanRuns: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    return this.mapProject(updated, updated.scanRuns);
  }

  async deleteProject(id: string, ownerId: string): Promise<boolean> {
    const prisma = await this.getClient();
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== ownerId) return false;
    await prisma.project.delete({ where: { id } });
    return true;
  }

  async createScanRun(input: CreateScanInput): Promise<ScanRunRecord> {
    const prisma = await this.getClient();
    const created = await prisma.scanRun.create({
      data: {
        shareSlug: generateSlug(),
        ownerId: input.ownerId ?? null,
        targetUrl: input.targetUrl,
        triggerType: input.triggerType ?? TriggerType.MANUAL,
        projectId: input.projectId ?? null,
      },
      include: { issues: true },
    });
    return this.mapScanRun(created);
  }

  async updateScanRun(id: string, patch: UpdateScanInput): Promise<ScanRunRecord | null> {
    const prisma = await this.getClient();
    const updated = await prisma.scanRun.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.scanMode !== undefined ? { scanMode: patch.scanMode } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.pagesScanned !== undefined ? { pagesScanned: patch.pagesScanned } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.startedAt !== undefined
          ? { startedAt: patch.startedAt ? new Date(patch.startedAt) : null }
          : {}),
        ...(patch.completedAt !== undefined
          ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }
          : {}),
      },
      include: { issues: true },
    });
    return this.mapScanRun(updated);
  }

  async addScanIssues(scanRunId: string, issues: ScanIssueInput[]): Promise<ScanIssueRecord[]> {
    const prisma = await this.getClient();
    if (issues.length > 0) {
      await prisma.scanIssue.createMany({
        data: issues.map((issue) => ({
          scanRunId,
          category: issue.category,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          remediation: issue.remediation,
          pageUrl: issue.pageUrl,
          evidence: issue.evidence,
        })),
      });
    }
    const rows = await prisma.scanIssue.findMany({ where: { scanRunId } });
    return rows.map((i: any) => ({
      id: i.id,
      scanRunId: i.scanRunId,
      category: i.category as IssueCategory,
      severity: i.severity as IssueSeverity,
      title: i.title,
      description: i.description,
      remediation: i.remediation,
      pageUrl: i.pageUrl,
      evidence: (i.evidence as Record<string, unknown>) ?? {},
      createdAt: i.createdAt.toISOString(),
    }));
  }

  async getScanByIdOrSlug(idOrSlug: string): Promise<ScanRunRecord | null> {
    const prisma = await this.getClient();
    const row = await prisma.scanRun.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { shareSlug: idOrSlug }],
      },
      include: { issues: true },
    });
    return row ? this.mapScanRun(row) : null;
  }

  async listRecentScans(limit = 15): Promise<ScanRunRecord[]> {
    const prisma = await this.getClient();
    const rows = await prisma.scanRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => this.mapScanRun(r));
  }

  async listScansByProject(projectId: string, limit = 10): Promise<ScanRunRecord[]> {
    const prisma = await this.getClient();
    const rows = await prisma.scanRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => this.mapScanRun(r));
  }

  async clearForTesting(): Promise<void> {
    const prisma = await this.getClient();
    await prisma.scanIssue.deleteMany();
    await prisma.scanRun.deleteMany();
    await prisma.project.deleteMany();
  }
}

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const usePrisma = Boolean(process.env.DATABASE_URL) && !isTestEnv;
const snapshotPath = isTestEnv
  ? null
  : process.env.VERCEL === '1'
    ? path.join('/tmp', 'shipcheck-store.json')
    : path.resolve(process.cwd(), 'backend', 'data', 'shipcheck-store.json');

export const store: ShipCheckStore = usePrisma
  ? new PrismaStore()
  : new LocalStore(snapshotPath);
