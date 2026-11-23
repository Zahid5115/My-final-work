import 'dotenv/config';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureSupabaseSystemRoles } from './routes/shared.ts';
import { getBootstrapConfig, hashPassword, isValidEmail, sanitizeText } from './security.ts';
import { appendActivityLog, getDbState, saveDbState } from './store.ts';
import { getSupabaseAdminClient, isProductionEnvironment } from './supabaseAdmin.ts';

function getArgValue(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1] ?? '';
  }
  return '';
}

async function runBootstrap(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const sb = getSupabaseAdminClient();
    if (isProductionEnvironment() && !sb) {
      console.error('Aborted: Production environments require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
      process.exit(1);
    }
    const mode = sb ? 'supabase' : 'local';
    console.log(`\nSmoker's Lawn Care Service — First Super Admin CLI Bootstrap (${mode} mode)\n`);

    if (sb) {
      const { count, error } = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_admin', true);
      if (error) {
        console.error('Supabase query failed. Confirm migrations 001–004 are applied:', error.message);
        process.exit(1);
      }
      if ((count ?? 0) > 0) {
        console.error('Aborted: A Super Admin already exists. Bootstrap is permanently locked.');
        process.exit(1);
      }
    } else {
      const db = getDbState();
      if (db.admins.length > 0) {
        console.error('Aborted: An administrator already exists. Bootstrap is permanently locked.');
        process.exit(1);
      }
    }

    const argName = sanitizeText(getArgValue('--name'), 120);
    const argEmail = sanitizeText(getArgValue('--email'), 254).toLowerCase();

    const fullName = argName || sanitizeText(await rl.question('Owner Full Name: '), 120);
    const email = argEmail || sanitizeText(await rl.question('Owner Email Address: '), 254).toLowerCase();

    if (!fullName || !isValidEmail(email)) {
      console.error('Invalid full name or email address.');
      process.exit(1);
    }

    const bootstrapConfig = getBootstrapConfig();
    if (bootstrapConfig.emailAllowlistConfigured && !bootstrapConfig.allowedEmails.includes(email)) {
      console.error(`Email must match ADMIN_BOOTSTRAP_EMAIL (${bootstrapConfig.allowedEmails.join(', ')}).`);
      process.exit(1);
    }

    let password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
    if (!password) {
      password = await rl.question('Initial Password (min 10 chars): ');
    }
    if (password.length < 10) {
      console.error('Password must be at least 10 characters.');
      process.exit(1);
    }

    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const superRole = roles.find((r) => r.name === 'Super Admin');
      if (!superRole) {
        console.error('Failed to ensure Super Admin role in admin_roles.');
        process.exit(1);
      }

      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName }
      });
      if (createErr || !created.user) {
        console.error('Failed to create Supabase Auth user:', createErr?.message);
        process.exit(1);
      }

      const { data: claimRows, error: rpcErr } = await sb.rpc('claim_first_super_admin', {
        p_user_id: created.user.id,
        p_email: email,
        p_full_name: fullName
      });

      if (!rpcErr) {
        const claimRow = Array.isArray(claimRows) ? claimRows[0] : claimRows;
        const didClaim = Boolean(
          claimRow && typeof claimRow === 'object' && (claimRow as { claimed?: unknown }).claimed
        );
        if (!didClaim) {
          await sb.auth.admin.deleteUser(created.user.id);
          console.error('Aborted: Another process claimed the first Super Admin concurrently.');
          process.exit(1);
        }
        console.log(`\nSuccess: First Super Admin (${email}) created atomically in Supabase. Setup is now locked.`);
        return;
      }

      const isMissingRpc =
        rpcErr.code === 'PGRST202' ||
        rpcErr.message.includes('claim_first_super_admin') ||
        rpcErr.message.includes('does not exist');

      if (!isMissingRpc) {
        await sb.auth.admin.deleteUser(created.user.id);
        console.error('Failed to claim first Super Admin via Supabase RPC:', rpcErr.message);
        process.exit(1);
      }

      // Fallback only if migration 004 has not yet been applied
      const { error: profErr } = await sb.from('profiles').upsert({
        id: created.user.id,
        email,
        full_name: fullName,
        role_id: superRole.id,
        is_admin: true,
        account_status: 'active',
        last_login_at: new Date().toISOString()
      });
      if (profErr) {
        await sb.auth.admin.deleteUser(created.user.id);
        console.error('Failed to create admin profile:', profErr.message);
        process.exit(1);
      }

      await sb.from('admin_activity_logs').insert({
        actor_id: created.user.id,
        actor_email: email,
        actor_role: 'Super Admin',
        action: 'first_admin_claimed_cli',
        entity_type: 'admin_user',
        entity_id: created.user.id,
        summary: `Initial Super Admin established via CLI for ${email}.`
      });

      console.log(`\nSuccess: First Super Admin (${email}) created in Supabase. Setup is now locked.`);
      return;
    }

    const db = getDbState();
    const now = new Date().toISOString();
    const adminId = crypto.randomUUID();
    db.admins.push({
      id: adminId,
      email,
      fullName,
      phone: '',
      avatarUrl: '',
      role: 'Super Admin',
      accountStatus: 'active',
      passwordHash: hashPassword(password),
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now
    });
    appendActivityLog(db, {
      actorId: adminId,
      actorEmail: email,
      actorRole: 'Super Admin',
      action: 'first_admin_claimed_cli',
      entityType: 'admin_user',
      entityId: adminId,
      summary: `Initial Super Admin established via CLI for ${email}.`
    });
    saveDbState(db);

    console.log(`\nSuccess: First Super Admin (${email}) created in local server store. Setup is now locked.`);
  } finally {
    rl.close();
  }
}

runBootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
