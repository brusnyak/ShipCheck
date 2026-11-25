import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type { Project, ScanIssue, ScanRun } from '../types/shipcheck';

export async function upsertUserProfile(uid: string, email: string, displayName: string): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        email: email.slice(0, 256),
        displayName: (displayName || 'Engineer').slice(0, 120),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid,
        email: email.slice(0, 256),
        displayName: (displayName || 'Engineer').slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveProjectToFirestore(project: Project): Promise<void> {
  const path = `projects/${project.id}`;
  const ref = doc(db, 'projects', project.id);
  try {
    await setDoc(ref, {
      ownerId: project.ownerId,
      name: project.name.slice(0, 100),
      targetUrl: project.targetUrl.slice(0, 512),
      webhookToken: project.webhookToken.slice(0, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function rotateProjectTokenInFirestore(
  projectId: string,
  newToken: string
): Promise<void> {
  const path = `projects/${projectId}`;
  const ref = doc(db, 'projects', projectId);
  try {
    await updateDoc(ref, {
      webhookToken: newToken.slice(0, 128),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function fetchUserProjectsFromFirestore(ownerId: string): Promise<Project[]> {
  const path = 'projects';
  try {
    const q = query(collection(db, 'projects'), where('ownerId', '==', ownerId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId),
        name: String(data.name),
        targetUrl: String(data.targetUrl),
        webhookToken: String(data.webhookToken),
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function persistScanReportToFirestore(
  scan: ScanRun,
  ownerId: string
): Promise<void> {
  if (scan.status !== 'COMPLETED' && scan.status !== 'FAILED') {
    return;
  }

  const reportId = scan.shareSlug;
  const reportPath = `scanReports/${reportId}`;
  const reportRef = doc(db, 'scanReports', reportId);

  try {
    const existing = await getDoc(reportRef);
    if (existing.exists()) {
      return;
    }

    const summary = scan.summary ?? {
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      passedChecks: [],
    };

    const batch = writeBatch(db);
    batch.set(reportRef, {
      shareSlug: scan.shareSlug,
      ownerId,
      projectId: scan.projectId ?? '',
      isPublic: true,
      targetUrl: scan.targetUrl.slice(0, 512),
      status: scan.status,
      triggerType: scan.triggerType,
      scanMode: scan.scanMode,
      score: scan.score ?? 0,
      grade: scan.grade ?? 'F',
      summary: {
        criticalCount: summary.criticalCount,
        warningCount: summary.warningCount,
        infoCount: summary.infoCount,
        passedChecks: (summary.passedChecks || []).slice(0, 50),
      },
      pagesScanned: scan.pagesScanned ?? 0,
      durationMs: scan.durationMs ?? 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const issues = (scan.issues ?? []).slice(0, 50);
    for (const issue of issues) {
      const issueId = issue.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      const issueRef = doc(db, 'scanReports', reportId, 'issues', issueId);
      const { screenshotDataUrl: _omitScreenshot, ...compactEvidence } = (issue.evidence ?? {}) as Record<
        string,
        unknown
      >;
      batch.set(issueRef, {
        ownerId,
        isPublic: true,
        category: issue.category,
        severity: issue.severity,
        title: issue.title.slice(0, 200),
        description: issue.description.slice(0, 1000),
        remediation: issue.remediation.slice(0, 1000),
        pageUrl: issue.pageUrl.slice(0, 512),
        evidence: compactEvidence,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, reportPath);
  }
}

export async function fetchScanReportFromFirestore(slug: string): Promise<ScanRun | null> {
  const reportPath = `scanReports/${slug}`;
  try {
    const reportSnap = await getDoc(doc(db, 'scanReports', slug));
    if (!reportSnap.exists()) {
      return null;
    }
    const data = reportSnap.data();
    const issuesSnap = await getDocs(collection(db, 'scanReports', slug, 'issues'));
    const issues: ScanIssue[] = issuesSnap.docs.map((d) => {
      const i = d.data();
      return {
        id: d.id,
        scanRunId: reportSnap.id,
        category: i.category,
        severity: i.severity,
        title: i.title,
        description: i.description,
        remediation: i.remediation,
        pageUrl: i.pageUrl,
        evidence: i.evidence || {},
        createdAt: i.createdAt?.toDate ? i.createdAt.toDate().toISOString() : new Date().toISOString(),
      };
    });

    return {
      id: reportSnap.id,
      shareSlug: data.shareSlug,
      ownerId: data.ownerId,
      projectId: data.projectId || null,
      targetUrl: data.targetUrl,
      status: data.status,
      triggerType: data.triggerType,
      scanMode: data.scanMode,
      score: data.score,
      grade: data.grade,
      summary: data.summary,
      pagesScanned: data.pagesScanned,
      durationMs: data.durationMs,
      errorMessage: null,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
      startedAt: null,
      completedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
      issues,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, reportPath);
  }
}
