import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const resetRequestSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
});

export const passwordSchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export const adminUserCreateSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Full name is required').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
    role: z.enum(['ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'STUDENT']),
    mode: z.enum(['invite', 'password']),
    password: z.string().max(72).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'password' && (!v.password || v.password.length < 10)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Temporary password must be at least 10 characters' });
    }
  });

export const adminUserToggleSchema = z.object({
  id: z.string().uuid('Invalid account'),
  is_active: z.boolean(),
});
