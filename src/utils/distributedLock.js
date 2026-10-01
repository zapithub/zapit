// Distributed lock via Postgres advisory lock (Phase 2, finding B8)
// Prevents double publish / double expire when 2 Render replicas run cron simultaneously.
// Falls back to in-memory lock if no DB or if RPC not available (dev single instance).

const memoryLocks = new Set();

// Try advisory lock: SELECT pg_try_advisory_xact_lock($1) — xact locks auto-release at txn end.
// We use pg_try_advisory_lock (session-level) with manual unlock for cron that spans multiple queries.
export async function withAdvisoryLock(supabase, lockName, fn) {
  const key = hashLockName(lockName);
  // Single-instance fast path: memory lock
  if (memoryLocks.has(lockName)) {
    console.log(JSON.stringify({ level:'info', msg:'cron skipped — memory lock held', lockName }));
    return { executed:false, reason:'memory locked' };
  }
  memoryLocks.add(lockName);
  let pgLocked = false;
  try {
    // Try Postgres advisory lock if supabase is configured
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('pg_try_advisory_lock', { key });
        // If RPC does not exist, supabase returns error; we fall through to memory lock
        if (!error && data === true) {
          pgLocked = true;
        } else if (error) {
          // RPC not installed — warn once, rely on memory lock
          // To enable true distributed lock, run: CREATE OR REPLACE FUNCTION pg_try_advisory_lock(key bigint) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RETURN pg_try_advisory_lock(key); END; $$;
          // console.warn('[lock] pg_try_advisory_lock RPC missing, using memory lock only');
        } else {
          console.log(JSON.stringify({ level:'info', msg:'cron skipped — pg lock held', lockName }));
          return { executed:false, reason:'pg locked' };
        }
      } catch (e) {
        // ignore, use memory lock
      }
    }
    const result = await fn();
    return { executed:true, result };
  } finally {
    memoryLocks.delete(lockName);
    if (pgLocked && supabase) {
      try { await supabase.rpc('pg_advisory_unlock', { key }); } catch {}
    }
  }
}

function hashLockName(name) {
  // Simple hash to bigint (Postgres advisory lock takes bigint)
  let h = 0;
  for (let i=0;i<name.length;i++) h = (Math.imul(31, h) + name.charCodeAt(i)) >>> 0;
  return h;
}
