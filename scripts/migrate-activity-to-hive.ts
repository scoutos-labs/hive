import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  db,
  roomKey,
  roomsListKey,
  postKey,
  postsByRoomKey,
  postsByAgentKey,
  addToSet,
  generateId,
} from '../src/db/index.js';

interface ActivityTask {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  category?: string;
  project?: string;
  created?: string;
  started?: string;
  completed?: string;
  findings_summary?: string;
  [key: string]: unknown;
}

interface ActivityFile {
  tasks: ActivityTask[];
  last_updated?: string;
}

const ROOM_ID = 'room_tasks';
const ROOM_NAME = 'tasks';
const SYSTEM_AUTHOR = 'agent/system';

function isoToMs(value?: string): number {
  if (!value) return Date.now();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Date.now();
}

async function ensureTaskRoom() {
  const existing = await db.get(roomKey(ROOM_ID));
  const now = Date.now();

  if (!existing) {
    await db.put(roomKey(ROOM_ID), {
      id: ROOM_ID,
      name: ROOM_NAME,
      description: 'Canonical task lifecycle events',
      createdBy: SYSTEM_AUTHOR,
      isPrivate: false,
      members: [SYSTEM_AUTHOR],
      createdAt: now,
      updatedAt: now,
    });
    await addToSet(roomsListKey(), ROOM_ID);
    console.log(`Created room: ${ROOM_ID}`);
  } else {
    console.log(`Room already exists: ${ROOM_ID}`);
  }
}

async function createEvent(taskId: string, type: string, payload: Record<string, unknown>, timestamp: number) {
  const postId = generateId('post');
  const envelope = {
    type,
    taskId,
    project: 'hive',
    timestamp: new Date(timestamp).toISOString(),
    actor: SYSTEM_AUTHOR,
    payload,
  };

  const post = {
    id: postId,
    roomId: ROOM_ID,
    authorId: SYSTEM_AUTHOR,
    content: JSON.stringify(envelope),
    createdAt: timestamp,
    updatedAt: timestamp,
    mentions: [],
  };

  await db.put(postKey(postId), post);
  await addToSet(postsByRoomKey(ROOM_ID), postId);
  await addToSet(postsByAgentKey(SYSTEM_AUTHOR), postId);
}

function normalizePriority(priority?: string): string {
  if (!priority) return 'P2';
  const p = String(priority).toUpperCase();
  if (['P0', 'P1', 'P2', 'P3'].includes(p)) return p;
  if (p === 'HIGH') return 'P1';
  if (p === 'MEDIUM') return 'P2';
  if (p === 'LOW') return 'P3';
  return 'P2';
}

function normalizeStatus(status?: string): string {
  const s = (status || 'pending').toLowerCase();
  if (s === 'complete' || s === 'completed') return 'complete';
  if (s === 'in_progress' || s === 'in-progress') return 'in_progress';
  if (s === 'blocked') return 'blocked';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'pending';
}

async function migrateTask(task: ActivityTask) {
  const createdAt = isoToMs(task.created);
  const normalizedStatus = normalizeStatus(task.status as string | undefined);

  await createEvent(
    task.id,
    'task.created',
    {
      title: task.title || task.id,
      description: task.description || '',
      priority: normalizePriority(task.priority as string | undefined),
      status: 'pending',
      labels: [task.category, task.project].filter(Boolean),
      owner: 'agent/unassigned',
      estimate: 'M',
      source: 'activity.json',
    },
    createdAt,
  );

  if (normalizedStatus === 'in_progress') {
    await createEvent(
      task.id,
      'task.status_changed',
      { from: 'pending', to: 'in_progress', reason: 'Imported from activity.json' },
      isoToMs(task.started as string | undefined),
    );
  }

  if (normalizedStatus === 'blocked') {
    await createEvent(
      task.id,
      'task.blocked',
      { blocker: 'Imported with blocked status from activity.json' },
      isoToMs(task.started as string | undefined),
    );
  }

  if (normalizedStatus === 'complete') {
    const doneAt = isoToMs(task.completed as string | undefined);
    await createEvent(
      task.id,
      'task.done',
      {
        summary: (task.findings_summary as string | undefined) || 'Imported as complete from activity.json',
        artifacts: [],
        verification: ['Imported record'],
      },
      doneAt,
    );
  }
}

async function main() {
  const activityPath = resolve(process.cwd(), '..', 'activity.json');
  const raw = readFileSync(activityPath, 'utf8');
  const parsed = JSON.parse(raw) as ActivityFile;

  if (!Array.isArray(parsed.tasks)) {
    throw new Error('Invalid activity.json: tasks[] missing');
  }

  await ensureTaskRoom();

  let migrated = 0;
  for (const task of parsed.tasks) {
    if (!task?.id) continue;
    await migrateTask(task);
    migrated += 1;
  }

  console.log(`Migrated ${migrated} tasks into Hive room ${ROOM_ID}`);
  await db.close();
}

main().catch(async (err) => {
  console.error(err);
  await db.close();
  process.exit(1);
});
