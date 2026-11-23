import crypto from 'node:crypto';
import type express from 'express';
import type { AdminRoleName, PermissionKey } from '../../src/types/platform.ts';
import { ALL_PERMISSION_KEYS } from '../../src/types/platform.ts';
import { isEmailServiceConfigured, sendTransactionalEmail } from '../email.ts';
import {
  createRateLimiter,
  getBootstrapConfig,
  hashPassword,
  isValidEmail,
  sanitizeText,
  signSessionToken,
  verifyPassword
} from '../security.ts';
import {
  DEFAULT_ROLES,
  appendActivityLog,
  getDbState,
  getPermissionsForRole,
  saveDbState
} from '../store.ts';
import {
  getSupabaseAdminClient,
  getSupabaseAnonClient,
  getSupabaseConfigDiagnostics,
  isProductionEnvironment
} from '../supabaseAdmin.ts';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  ensureSupabaseSystemRoles,
  extractRoleRelation,
  insertSupabaseAuditLog,
  loadSupabaseAdminProfile,
  requireAdmin,
  requirePermission,
  resolveAdminFromRequest,
  runWithBootstrapLock,
  setSessionCookie
} from './shared.ts';

export function registerAuthAndUsersRoutes(router: express.Router): void {
  const authLimiter = createRateLimiter(15, 15 * 60 * 1000);

  // ===========================================================================
  // ADMIN AUTHENTICATION & ATOMIC FIRST-ADMIN BOOTSTRAP
  // ===========================================================================
  router.get('/admin/auth/status', async (_req, res) => {
    const bootstrap = getBootstrapConfig();
    const bootstrapConfigured = bootstrap.secretConfigured;
    const requiresBootstrapEmail = bootstrap.emailAllowlistConfigured;
    const diag = getSupabaseConfigDiagnostics();
    const supabaseUrlInvalid = diag.urlConfigured && !diag.urlValid;

    const sb = getSupabaseAdminClient();
    if (sb) {
      try {
        const { count, error } = await sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true);

        if (error) {
          res.json({
            needsFirstAdminSetup: true,
            authMode: 'supabase',
            emailConfigured: true,
            bootstrapConfigured,
            requiresBootstrapSecret: true,
            requiresBootstrapEmail,
            supabaseUrlInvalid,
            anonKeyConfigured: diag.anonKeyConfigured,
            supabaseWarning: `Supabase profiles table check returned: ${error.message}`
          });
          return;
        }

        res.json({
          needsFirstAdminSetup: (count ?? 0) === 0,
          authMode: 'supabase',
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid,
          anonKeyConfigured: diag.anonKeyConfigured
        });
        return;
      } catch (err) {
        res.json({
          needsFirstAdminSetup: true,
          authMode: 'supabase',
          emailConfigured: true,
          bootstrapConfigured,
          requiresBootstrapSecret: true,
          requiresBootstrapEmail,
          supabaseUrlInvalid,
          anonKeyConfigured: diag.anonKeyConfigured,
          supabaseWarning: err instanceof Error ? err.message : 'Unable to reach Supabase.'
        });
        return;
      }
    }

    if (isProductionEnvironment()) {
      res.json({
        needsFirstAdminSetup: false,
        authMode: 'unconfigured',
        emailConfigured: isEmailServiceConfigured(),
        bootstrapConfigured,
        requiresBootstrapSecret: true,
        requiresBootstrapEmail,
        supabaseUrlInvalid,
        anonKeyConfigured: diag.anonKeyConfigured,
        productionConfigError:
          'Supabase server credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are required in production. Local JSON persistence (data/platform-db.json) is disabled.'
      });
      return;
    }

    const db = getDbState();
    res.json({
      needsFirstAdminSetup: db.admins.length === 0,
      authMode: 'local',
      emailConfigured: isEmailServiceConfigured(),
      bootstrapConfigured,
      requiresBootstrapSecret: true,
      requiresBootstrapEmail,
      supabaseUrlInvalid,
      anonKeyConfigured: diag.anonKeyConfigured
    });
  });

  router.post('/admin/auth/setup-first-admin', authLimiter, async (req, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const bootstrapSecret = sanitizeText(req.body?.bootstrapSecret, 500);

    const bootstrap = getBootstrapConfig();
    if (!bootstrap.secretConfigured) {
      res.status(403).json({
        error:
          'First-admin setup is locked until ADMIN_BOOTSTRAP_SECRET is configured on the server by the project owner.'
      });
      return;
    }

    const providedBuf = Buffer.from(bootstrapSecret, 'utf8');
    const expectedBuf = Buffer.from(bootstrap.secret, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(403).json({ error: 'Invalid server setup secret.' });
      return;
    }

    if (bootstrap.emailAllowlistConfigured && !bootstrap.allowedEmails.includes(email)) {
      res.status(403).json({
        error: 'This email address is not authorized by ADMIN_BOOTSTRAP_EMAIL to claim the initial Super Admin.'
      });
      return;
    }

    if (!fullName || !isValidEmail(email) || password.length < 10) {
      res.status(400).json({
        error: 'Provide a full name, valid email address, and password of at least 10 characters.'
      });
      return;
    }

    await runWithBootstrapLock(async () => {
      const sb = getSupabaseAdminClient();
      if (sb) {
        const { count, error: countErr } = await sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true);

        if (countErr) {
          res.status(500).json({
            error: `Unable to verify Supabase admin table (${countErr.message}). Confirm migrations 001–004 have been executed.`
          });
          return;
        }

        if ((count ?? 0) > 0) {
          res.status(409).json({
            error: 'First administrator has already been established. This one-time setup is permanently locked.'
          });
          return;
        }

        const roles = await ensureSupabaseSystemRoles(sb);
        const superRole = roles.find((r) => r.name === 'Super Admin');
        if (!superRole) {
          res.status(500).json({ error: 'Super Admin role record is missing in admin_roles.' });
          return;
        }

        let userId = '';
        let createdNewAuthUser = false;

        const { data: createdAuth, error: authErr } = await sb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName }
        });

        if (createdAuth?.user && !authErr) {
          userId = createdAuth.user.id;
          createdNewAuthUser = true;
        } else {
          const alreadyExists =
            authErr?.message?.toLowerCase().includes('already') ||
            authErr?.message?.toLowerCase().includes('registered') ||
            authErr?.status === 422;

          if (alreadyExists) {
            // If an auth user exists from an unlinked manual signup or prior partial setup while 0 admins exist,
            // verify ownership via password sign-in before linking them as the first Super Admin.
            const sbAnon = getSupabaseAnonClient();
            if (sbAnon) {
              const { data: existingSignIn, error: existingErr } = await sbAnon.auth.signInWithPassword({
                email,
                password
              });
              if (!existingErr && existingSignIn.user) {
                userId = existingSignIn.user.id;
              }
            }
            if (!userId) {
              res.status(400).json({
                error:
                  'A Supabase Authentication user with this email already exists with a different password (or unlinked state). Enter that account’s existing password or remove the unlinked user in Supabase Dashboard → Authentication → Users and retry.'
              });
              return;
            }
          } else {
            res.status(400).json({ error: authErr?.message || 'Unable to create Supabase admin user.' });
            return;
          }
        }

        const rollbackIfNew = async () => {
          if (createdNewAuthUser && userId) {
            await sb.auth.admin.deleteUser(userId);
          }
        };

        const { data: claimed, error: claimErr } = await sb.rpc('claim_first_super_admin', {
          p_user_id: userId,
          p_email: email,
          p_full_name: fullName
        });

        let usedFallbackInsert = false;

        if (claimErr) {
          const isMissingRpc =
            claimErr.code === 'PGRST202' ||
            claimErr.message.includes('claim_first_super_admin') ||
            claimErr.message.includes('does not exist');

          if (isMissingRpc) {
            usedFallbackInsert = true;
            const now = new Date().toISOString();
            const { error: upsertErr } = await sb.from('profiles').upsert({
              id: userId,
              email,
              full_name: fullName,
              role_id: superRole.id,
              is_admin: true,
              account_status: 'active',
              last_login_at: now
            });
            if (upsertErr) {
              await rollbackIfNew();
              res.status(500).json({
                error: `Failed to assign Super Admin profile in Supabase: ${upsertErr.message}`
              });
              return;
            }
            const { count: postCount } = await sb
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .eq('is_admin', true);
            if ((postCount ?? 0) > 1) {
              await sb.from('profiles').delete().eq('id', userId);
              await rollbackIfNew();
              res.status(409).json({
                error: 'First administrator was claimed concurrently. This one-time setup is permanently locked.'
              });
              return;
            }
          } else {
            await rollbackIfNew();
            res.status(500).json({
              error: `Failed to atomically claim Super Admin in Supabase: ${claimErr.message}`
            });
            return;
          }
        } else {
          const claimRow = Array.isArray(claimed) ? claimed[0] : claimed;
          const didClaim =
            typeof claimRow === 'boolean'
              ? claimRow
              : Boolean(claimRow && typeof claimRow === 'object' && (claimRow as { claimed?: unknown }).claimed);
          if (!didClaim) {
            await rollbackIfNew();
            res.status(409).json({
              error: 'First administrator has already been established. This one-time setup is permanently locked.'
            });
            return;
          }
        }

        if (usedFallbackInsert) {
          await insertSupabaseAuditLog(sb, {
            actorId: userId,
            actorEmail: email,
            actorRole: 'Super Admin',
            action: 'first_admin_claimed',
            entityType: 'admin_user',
            entityId: userId,
            summary: `Initial Super Admin account established for ${email}.`
          });
        }

        res.status(201).json({
          setupComplete: true,
          authMode: 'supabase',
          message: 'First Super Admin account created and verified in Supabase. Setup is now permanently locked.'
        });
        return;
      }

      if (isProductionEnvironment()) {
        res.status(503).json({
          error: 'Supabase is required in production before creating the first Super Admin.'
        });
        return;
      }

      const db = getDbState();
      if (db.admins.length > 0) {
        res.status(409).json({
          error: 'First administrator has already been established. This one-time setup is permanently locked.'
        });
        return;
      }

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
        action: 'first_admin_claimed',
        entityType: 'admin_user',
        entityId: adminId,
        summary: `Initial Super Admin account claimed for ${email}.`
      });
      saveDbState(db);

      const token = signSessionToken(adminId, email);
      setSessionCookie(req, res, token);

      res.status(201).json({
        setupComplete: true,
        authMode: 'local',
        token,
        user: {
          id: adminId,
          email,
          fullName,
          phone: '',
          avatarUrl: '',
          role: 'Super Admin',
          accountStatus: 'active',
          permissions: getPermissionsForRole(db, 'Super Admin'),
          lastLoginAt: now,
          createdAt: now
        }
      });
    });
  });

  // Finalize & audit a browser-side Supabase sign-in and mirror session in an HttpOnly cookie
  router.post('/admin/auth/session', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const sb = getSupabaseAdminClient();
    const now = new Date().toISOString();

    if (sb && req.adminUser) {
      await sb.from('profiles').update({ last_login_at: now }).eq('id', req.adminUser.id);
      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser.id,
        actorEmail: req.adminUser.email,
        actorRole: req.adminUser.role,
        action: 'admin_login',
        entityType: 'admin_user',
        entityId: req.adminUser.id,
        summary: `${req.adminUser.fullName} (${req.adminUser.role}) signed in.`
      });
    }

    if (token) {
      setSessionCookie(req, res, token, 3600);
    }
    res.json({ user: { ...req.adminUser!, lastLoginAt: now } });
  });

  router.post('/admin/auth/login', authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (!sbAnon) {
        res.status(500).json({
          error:
            'Supabase server mode is enabled, but VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is not configured for password sign-in.'
        });
        return;
      }

      const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({
        email,
        password
      });
      if (signInErr || !signInData.session?.access_token || !signInData.user) {
        const msg = signInErr?.message?.toLowerCase() ?? '';
        if (msg.includes('email not confirmed')) {
          res.status(403).json({
            error: 'Your email address has not been confirmed in Supabase Auth yet. Check your inbox or confirm the user in Supabase Dashboard.'
          });
          return;
        }
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const profileResult = await loadSupabaseAdminProfile(sb, signInData.user.id, {
        activateInvitedIfConfirmed: true,
        authUserConfirmed: true
      });
      if (!profileResult.ok) {
        res.status(profileResult.status).json({ error: profileResult.error });
        return;
      }

      const user = profileResult.user;
      const now = new Date().toISOString();
      await sb.from('profiles').update({ last_login_at: now }).eq('id', user.id);
      await insertSupabaseAuditLog(sb, {
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'admin_login',
        entityType: 'admin_user',
        entityId: user.id,
        summary: `${user.fullName} (${user.role}) signed in.`
      });

      setSessionCookie(
        req,
        res,
        signInData.session.access_token,
        signInData.session.expires_in ?? 3600
      );

      res.json({
        token: signInData.session.access_token,
        user: {
          ...user,
          lastLoginAt: now
        }
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (admin.accountStatus !== 'active') {
      res.status(403).json({ error: 'This administrator account is currently suspended or inactive.' });
      return;
    }

    const now = new Date().toISOString();
    admin.lastLoginAt = now;
    admin.updatedAt = now;
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'admin_login',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `${admin.fullName} (${admin.role}) signed in.`
    });
    saveDbState(db);

    const token = signSessionToken(admin.id, admin.email);
    setSessionCookie(req, res, token);

    res.json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        phone: admin.phone,
        avatarUrl: admin.avatarUrl,
        role: admin.role,
        accountStatus: admin.accountStatus,
        permissions: getPermissionsForRole(db, admin.role),
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt
      }
    });
  });

  router.post('/admin/auth/logout', async (req: AuthenticatedRequest, res) => {
    const resolved = await resolveAdminFromRequest(req);
    if (resolved?.jti && !getSupabaseAdminClient() && !isProductionEnvironment()) {
      const db = getDbState();
      db.revokedJtis.push(resolved.jti);
      if (db.revokedJtis.length > 5000) {
        db.revokedJtis.splice(0, db.revokedJtis.length - 5000);
      }
      saveDbState(db);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/admin/auth/me', requireAdmin, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.adminUser });
  });

  router.post('/admin/auth/forgot-password', authLimiter, async (req, res) => {
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (sbAnon) {
        await sbAnon.auth.resetPasswordForEmail(email, {
          redirectTo: `${baseUrl.replace(/\/$/, '')}/admin/reset-password`
        });
        res.json({
          message: 'If an administrator account matches that email, Supabase has sent a password reset link.',
          emailSent: true
        });
        return;
      }
      res.json({
        message: 'Supabase anon key is not configured for self-service reset emails.',
        emailSent: false
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.email.toLowerCase() === email);
    if (!admin) {
      res.json({
        message: 'If an administrator account matches that email, reset instructions have been processed.',
        emailSent: false
      });
      return;
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.passwordResets.push({
      id: crypto.randomUUID(),
      adminId: admin.id,
      tokenHash,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString()
    });
    saveDbState(db);

    const resetUrl = `${baseUrl.replace(/\/$/, '')}/admin/reset-password?token=${rawToken}`;

    const mailResult = await sendTransactionalEmail({
      to: admin.email,
      subject: "Smoker's Lawn Care Admin — Password Reset",
      text: `Use this link within 30 minutes to reset your Admin Portal password:\n\n${resetUrl}`
    });

    if (mailResult.sent) {
      res.json({
        message: 'Password reset link has been sent to your administrator email address.',
        emailSent: true
      });
      return;
    }

    res.json({
      message:
        'No transactional email provider (RESEND_API_KEY) is configured on this server, so no email was sent.',
      emailSent: false,
      emailReason: mailResult.reason
    });
  });

  router.post('/admin/auth/reset-password', authLimiter, (req, res) => {
    if (getSupabaseAdminClient()) {
      res.status(400).json({
        error: 'Password recovery in Supabase mode uses the recovery link sent to your email.'
      });
      return;
    }

    const token = sanitizeText(req.body?.token, 200);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!token || newPassword.length < 10) {
      res.status(400).json({ error: 'Valid reset token and new password (10+ characters) are required.' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDbState();
    const record = db.passwordResets.find(
      (r) => r.tokenHash === tokenHash && !r.used && new Date(r.expiresAt).getTime() > Date.now()
    );

    if (!record) {
      res.status(400).json({ error: 'Reset token is invalid or has expired.' });
      return;
    }

    const admin = db.admins.find((a) => a.id === record.adminId);
    if (!admin) {
      res.status(404).json({ error: 'Administrator account not found.' });
      return;
    }

    record.used = true;
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'password_reset_completed',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `Password reset completed for ${admin.email}.`
    });
    saveDbState(db);

    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  });

  router.post('/admin/auth/change-password', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword || newPassword.length < 10) {
      res.status(400).json({ error: 'Current password and new password (10+ characters) are required.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const sbAnon = getSupabaseAnonClient();
      if (!sbAnon) {
        res.status(500).json({
          error: 'Supabase anon key is required to verify your current password before updating.'
        });
        return;
      }

      const { error: verifyErr } = await sbAnon.auth.signInWithPassword({
        email: req.adminUser!.email,
        password: currentPassword
      });
      if (verifyErr) {
        res.status(401).json({ error: 'Current password is incorrect.' });
        return;
      }

      const { error: updateErr } = await sb.auth.admin.updateUserById(req.adminUser!.id, {
        password: newPassword
      });
      if (updateErr) {
        res.status(500).json({ error: `Unable to update password: ${updateErr.message}` });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: 'password_changed',
        entityType: 'admin_user',
        entityId: req.adminUser!.id,
        summary: `Administrator ${req.adminUser!.email} changed their password.`
      });
      res.json({ ok: true });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser!.id);
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    appendActivityLog(db, {
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: 'password_changed',
      entityType: 'admin_user',
      entityId: admin.id,
      summary: `Administrator ${admin.email} changed their password.`
    });
    saveDbState(db);
    res.json({ ok: true });
  });

  // ===========================================================================
  // SUPER ADMIN USER & RBAC ROLE MANAGEMENT
  // ===========================================================================
  router.get('/admin/users', requireAdmin, requirePermission('admin_users.manage'), async (_req, res) => {
    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const { data: permRows } = await sb
        .from('role_permissions')
        .select('role_id, permission_key, allowed')
        .eq('allowed', true);

      const permsByRoleId = new Map<string, PermissionKey[]>();
      for (const p of permRows ?? []) {
        const list = permsByRoleId.get(p.role_id) ?? [];
        list.push(p.permission_key as PermissionKey);
        permsByRoleId.set(p.role_id, list);
      }

      const roleConfigs = DEFAULT_ROLES.map((def) => {
        const dbRole = roles.find((r) => r.name === def.role);
        return {
          role: def.role,
          description: dbRole?.description || def.description,
          permissions:
            def.role === 'Super Admin'
              ? [...ALL_PERMISSION_KEYS]
              : dbRole
              ? permsByRoleId.get(dbRole.id) ?? def.permissions
              : def.permissions
        };
      });

      const { data: profileRows, error: profErr } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, admin_roles(id, name)')
        .eq('is_admin', true)
        .order('created_at', { ascending: true });

      if (profErr) {
        res.status(500).json({ error: `Unable to load administrators: ${profErr.message}` });
        return;
      }

      const items = (profileRows ?? []).map((p) => {
        const roleRel = extractRoleRelation(p.admin_roles);
        const roleName: AdminRoleName = roleRel?.name ?? 'Admin';
        const perms =
          roleName === 'Super Admin'
            ? [...ALL_PERMISSION_KEYS]
            : roleRel?.id
            ? permsByRoleId.get(roleRel.id) ?? []
            : [];
        return {
          id: p.id,
          email: p.email,
          fullName: p.full_name,
          phone: p.phone ?? '',
          avatarUrl: p.avatar_url ?? '',
          role: roleName,
          accountStatus: p.account_status as 'active' | 'suspended' | 'invited',
          permissions: perms,
          lastLoginAt: p.last_login_at,
          createdAt: p.created_at
        };
      });

      res.json({ items, roles: roleConfigs, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: 'supabase' });
      return;
    }

    const db = getDbState();
    const users = db.admins.map((a) => ({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      phone: a.phone,
      avatarUrl: a.avatarUrl,
      role: a.role,
      accountStatus: a.accountStatus,
      permissions: getPermissionsForRole(db, a.role),
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt
    }));
    res.json({ items: users, roles: db.roles, allPermissionKeys: ALL_PERMISSION_KEYS, authMode: 'local' });
  });

  router.post('/admin/users', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const fullName = sanitizeText(req.body?.fullName, 120);
    const email = sanitizeText(req.body?.email, 254).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 40);
    const role = sanitizeText(req.body?.role, 40) as AdminRoleName;
    const inviteMode = req.body?.inviteMode === 'email' ? 'email' : 'password';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const validRole = DEFAULT_ROLES.some((r) => r.role === role);
    if (!fullName || !isValidEmail(email) || !validRole) {
      res.status(400).json({ error: 'Full name, valid email address, and valid administrator role are required.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      if (inviteMode === 'password' && password.length < 10) {
        res.status(400).json({ error: 'Initial password must be at least 10 characters when creating directly.' });
        return;
      }

      const { data: existingProfile } = await sb
        .from('profiles')
        .select('id, is_admin')
        .eq('email', email)
        .maybeSingle();

      if (existingProfile?.is_admin) {
        res.status(409).json({ error: 'An administrator with that email already exists.' });
        return;
      }

      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === role);
      if (!roleRow) {
        res.status(400).json({ error: 'Selected role could not be resolved.' });
        return;
      }

      const baseUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
      let userId = existingProfile?.id ?? '';
      let createdNewAuthUser = false;
      let accountStatus: 'active' | 'invited' = 'active';

      if (!userId) {
        if (inviteMode === 'email') {
          const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
            redirectTo: `${baseUrl.replace(/\/$/, '')}/admin/reset-password`
          });
          if (inviteErr || !invited.user) {
            const msg = inviteErr?.message || 'Unable to send Supabase invitation email.';
            res.status(400).json({
              error: msg.toLowerCase().includes('already')
                ? 'A user with this email already exists in Supabase Auth without an admin profile. Remove the unlinked user in Supabase Authentication or create directly.'
                : msg
            });
            return;
          }
          userId = invited.user.id;
          createdNewAuthUser = true;
          accountStatus = 'invited';
        } else {
          const { data: created, error: createErr } = await sb.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName }
          });
          if (createErr || !created.user) {
            const msg = createErr?.message || 'Unable to create Supabase user.';
            res.status(400).json({
              error: msg.toLowerCase().includes('already')
                ? 'A user with this email already exists in Supabase Auth without an admin profile. Remove the unlinked user in Supabase Authentication before re-adding.'
                : msg
            });
            return;
          }
          userId = created.user.id;
          createdNewAuthUser = true;
          accountStatus = 'active';
        }
      }

      const { error: upsertErr } = await sb.from('profiles').upsert({
        id: userId,
        email,
        full_name: fullName,
        phone,
        role_id: roleRow.id,
        is_admin: true,
        account_status: accountStatus
      });

      if (upsertErr) {
        if (createdNewAuthUser) {
          await sb.auth.admin.deleteUser(userId);
        }
        res.status(500).json({ error: `Unable to save administrator profile: ${upsertErr.message}` });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: inviteMode === 'email' ? 'admin_user_invited' : 'admin_user_created',
        entityType: 'admin_user',
        entityId: userId,
        summary: `${inviteMode === 'email' ? 'Invited' : 'Created'} admin ${email} with role ${role}.`
      });

      const { data: permRows } = await sb
        .from('role_permissions')
        .select('permission_key')
        .eq('role_id', roleRow.id)
        .eq('allowed', true);

      res.status(201).json({
        item: {
          id: userId,
          email,
          fullName,
          phone,
          avatarUrl: '',
          role,
          accountStatus,
          permissions:
            role === 'Super Admin'
              ? [...ALL_PERMISSION_KEYS]
              : (permRows ?? []).map((p) => p.permission_key as PermissionKey),
          lastLoginAt: null,
          createdAt: new Date().toISOString()
        }
      });
      return;
    }

    if (password.length < 10) {
      res.status(400).json({ error: 'Initial password (10+ characters) is required in local server mode.' });
      return;
    }

    const db = getDbState();
    if (db.admins.some((a) => a.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'An administrator with that email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const newAdmin = {
      id: crypto.randomUUID(),
      email,
      fullName,
      phone,
      avatarUrl: '',
      role,
      accountStatus: 'active' as const,
      passwordHash: hashPassword(password),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    };
    db.admins.push(newAdmin);
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'admin_user_invited',
      entityType: 'admin_user',
      entityId: newAdmin.id,
      summary: `Created admin account ${email} with role ${role}.`
    });
    saveDbState(db);

    res.status(201).json({
      item: {
        id: newAdmin.id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        phone: newAdmin.phone,
        avatarUrl: newAdmin.avatarUrl,
        role: newAdmin.role,
        accountStatus: newAdmin.accountStatus,
        permissions: getPermissionsForRole(db, newAdmin.role),
        lastLoginAt: newAdmin.lastLoginAt,
        createdAt: newAdmin.createdAt
      }
    });
  });

  router.patch('/admin/users/:id', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const targetId = req.params.id;
    const requestedRole = req.body?.role ? (sanitizeText(req.body.role, 40) as AdminRoleName) : undefined;
    const requestedStatus = ['active', 'suspended'].includes(req.body?.accountStatus)
      ? (req.body.accountStatus as 'active' | 'suspended')
      : undefined;

    if (targetId === req.adminUser!.id && requestedStatus === 'suspended') {
      res.status(400).json({ error: 'You cannot suspend your own active administrator session.' });
      return;
    }

    const sb = getSupabaseAdminClient();
    if (sb) {
      const { data: target, error: findErr } = await sb
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at, is_admin, admin_roles(id, name)')
        .eq('id', targetId)
        .eq('is_admin', true)
        .single();

      if (findErr || !target) {
        res.status(404).json({ error: 'Administrator not found.' });
        return;
      }

      const currentRoleRel = extractRoleRelation(target.admin_roles);
      const currentRoleName: AdminRoleName = currentRoleRel?.name ?? 'Admin';
      const roles = await ensureSupabaseSystemRoles(sb);

      const willLeaveSuperAdmin =
        currentRoleName === 'Super Admin' &&
        ((requestedRole && requestedRole !== 'Super Admin') || requestedStatus === 'suspended');

      if (willLeaveSuperAdmin) {
        const superRole = roles.find((r) => r.name === 'Super Admin');
        const { count: activeSupers } = await sb
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true)
          .eq('account_status', 'active')
          .eq('role_id', superRole?.id ?? '');
        if ((activeSupers ?? 0) <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain.' });
          return;
        }
      }

      const updates: Record<string, unknown> = {};
      let nextRoleName: AdminRoleName = currentRoleName;
      let nextRoleId = currentRoleRel?.id ?? '';

      if (requestedRole) {
        const nextRoleObj = roles.find((r) => r.name === requestedRole);
        if (!nextRoleObj) {
          res.status(400).json({ error: 'Invalid administrator role.' });
          return;
        }
        updates.role_id = nextRoleObj.id;
        nextRoleName = nextRoleObj.name;
        nextRoleId = nextRoleObj.id;
      }
      if (requestedStatus) {
        updates.account_status = requestedStatus;
      }
      if (req.body?.fullName !== undefined) {
        const cleaned = sanitizeText(req.body.fullName, 120);
        if (cleaned) updates.full_name = cleaned;
      }
      if (req.body?.phone !== undefined) {
        updates.phone = sanitizeText(req.body.phone, 40);
      }

      const { data: updated, error: updErr } = await sb
        .from('profiles')
        .update(updates)
        .eq('id', targetId)
        .select('id, email, full_name, phone, avatar_url, account_status, last_login_at, created_at')
        .single();

      if (updErr || !updated) {
        res.status(500).json({ error: updErr?.message || 'Unable to update administrator.' });
        return;
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: 'admin_user_updated',
        entityType: 'admin_user',
        entityId: targetId,
        summary: `Updated admin ${updated.email} (role: ${nextRoleName}, status: ${updated.account_status}).`
      });

      let permissions: PermissionKey[] = [...ALL_PERMISSION_KEYS];
      if (nextRoleName !== 'Super Admin' && nextRoleId) {
        const { data: permRows } = await sb
          .from('role_permissions')
          .select('permission_key')
          .eq('role_id', nextRoleId)
          .eq('allowed', true);
        permissions = (permRows ?? []).map((p) => p.permission_key as PermissionKey);
      }

      res.json({
        item: {
          id: updated.id,
          email: updated.email,
          fullName: updated.full_name,
          phone: updated.phone ?? '',
          avatarUrl: updated.avatar_url ?? '',
          role: nextRoleName,
          accountStatus: updated.account_status,
          permissions,
          lastLoginAt: updated.last_login_at,
          createdAt: updated.created_at
        }
      });
      return;
    }

    const db = getDbState();
    const target = db.admins.find((a) => a.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'Administrator not found.' });
      return;
    }

    if (requestedRole && db.roles.some((r) => r.role === requestedRole)) {
      if (target.role === 'Super Admin' && requestedRole !== 'Super Admin') {
        const superCount = db.admins.filter((a) => a.role === 'Super Admin' && a.accountStatus === 'active').length;
        if (superCount <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain.' });
          return;
        }
      }
      target.role = requestedRole;
    }
    if (requestedStatus) {
      if (target.role === 'Super Admin' && requestedStatus === 'suspended') {
        const superCount = db.admins.filter((a) => a.role === 'Super Admin' && a.accountStatus === 'active').length;
        if (superCount <= 1) {
          res.status(400).json({ error: 'At least one active Super Admin must remain active.' });
          return;
        }
      }
      target.accountStatus = requestedStatus;
    }
    if (req.body?.fullName !== undefined) target.fullName = sanitizeText(req.body.fullName, 120) || target.fullName;
    if (req.body?.phone !== undefined) target.phone = sanitizeText(req.body.phone, 40);
    target.updatedAt = new Date().toISOString();

    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'admin_user_updated',
      entityType: 'admin_user',
      entityId: target.id,
      summary: `Updated admin ${target.email} (role: ${target.role}, status: ${target.accountStatus}).`
    });
    saveDbState(db);

    res.json({
      item: {
        id: target.id,
        email: target.email,
        fullName: target.fullName,
        phone: target.phone,
        avatarUrl: target.avatarUrl,
        role: target.role,
        accountStatus: target.accountStatus,
        permissions: getPermissionsForRole(db, target.role),
        lastLoginAt: target.lastLoginAt,
        createdAt: target.createdAt
      }
    });
  });

  router.put('/admin/roles/:roleName', requireAdmin, requirePermission('admin_users.manage'), async (req: AuthenticatedRequest, res) => {
    const roleName = sanitizeText(req.params.roleName, 40) as AdminRoleName;
    if (roleName === 'Super Admin') {
      res.status(400).json({ error: 'Super Admin retains all platform permissions.' });
      return;
    }

    const requestedPerms: PermissionKey[] = Array.isArray(req.body?.permissions)
      ? req.body.permissions.filter((p: unknown): p is PermissionKey => ALL_PERMISSION_KEYS.includes(p as PermissionKey))
      : [];

    const sb = getSupabaseAdminClient();
    if (sb) {
      const roles = await ensureSupabaseSystemRoles(sb);
      const roleRow = roles.find((r) => r.name === roleName);
      if (!roleRow) {
        res.status(404).json({ error: 'Role not found.' });
        return;
      }

      await sb.from('role_permissions').delete().eq('role_id', roleRow.id);
      if (requestedPerms.length > 0) {
        const { error: insErr } = await sb.from('role_permissions').insert(
          requestedPerms.map((perm) => ({
            role_id: roleRow.id,
            permission_key: perm,
            allowed: true
          }))
        );
        if (insErr) {
          res.status(500).json({ error: `Failed to save role permissions: ${insErr.message}` });
          return;
        }
      }

      await insertSupabaseAuditLog(sb, {
        actorId: req.adminUser!.id,
        actorEmail: req.adminUser!.email,
        actorRole: req.adminUser!.role,
        action: 'role_permissions_updated',
        entityType: 'admin_role',
        entityId: roleName,
        summary: `Updated permissions for role ${roleName} (${requestedPerms.length} granted).`
      });

      res.json({
        item: {
          role: roleName,
          description: roleRow.description,
          permissions: requestedPerms
        }
      });
      return;
    }

    const db = getDbState();
    const role = db.roles.find((r) => r.role === roleName);
    if (!role) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }

    role.permissions = requestedPerms;
    appendActivityLog(db, {
      actorId: req.adminUser!.id,
      actorEmail: req.adminUser!.email,
      actorRole: req.adminUser!.role,
      action: 'role_permissions_updated',
      entityType: 'admin_role',
      entityId: role.role,
      summary: `Updated permissions for role ${role.role} (${requestedPerms.length} granted).`
    });
    saveDbState(db);
    res.json({ item: role });
  });

  // Protected Profile Self-Update (does NOT allow changing role or permissions)
  router.patch('/admin/profile', requireAdmin, async (req: AuthenticatedRequest, res) => {
    const nextName = req.body?.fullName !== undefined ? sanitizeText(req.body.fullName, 120) : undefined;
    const nextPhone = req.body?.phone !== undefined ? sanitizeText(req.body.phone, 40) : undefined;

    const sb = getSupabaseAdminClient();
    if (sb) {
      const updates: Record<string, string> = {};
      if (nextName) updates.full_name = nextName;
      if (nextPhone !== undefined) updates.phone = nextPhone;
      const { error } = await sb.from('profiles').update(updates).eq('id', req.adminUser!.id);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({
        user: {
          ...req.adminUser!,
          fullName: nextName || req.adminUser!.fullName,
          phone: nextPhone !== undefined ? nextPhone : req.adminUser!.phone
        }
      });
      return;
    }

    const db = getDbState();
    const admin = db.admins.find((a) => a.id === req.adminUser!.id);
    if (!admin) {
      res.status(404).json({ error: 'Profile not found.' });
      return;
    }
    if (nextName) admin.fullName = nextName;
    if (nextPhone !== undefined) admin.phone = nextPhone;
    admin.updatedAt = new Date().toISOString();
    saveDbState(db);
    res.json({
      user: {
        ...req.adminUser!,
        fullName: admin.fullName,
        phone: admin.phone
      }
    });
  });
}
