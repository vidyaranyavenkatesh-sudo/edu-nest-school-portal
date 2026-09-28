import type { NavItem } from '@/components/Shell'

export const PORTAL = 'school'
export const APP_NAME = 'EduNest School'
export const TAGLINE = 'School Portal for teachers and office staff'
export const LOGIN_TAGLINE = 'School Portal · teachers and office staff'
export const ALLOWED_ROLES = ['admin', 'teacher']
export const OTHER_PORTAL_MESSAGE = 'This login is for students. Please use the Student Portal website.'
export const ACCENT = '#4f46e5'
export const ACCENT_SOFT = '#eef0ff'

export const NAV: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/attendance', label: 'Attendance', group: 'Teaching' },
  { href: '/my-attendance', label: 'My attendance', roles: ['teacher'], group: 'Teaching' },
  { href: '/notes', label: 'Daily notes', group: 'Teaching' },
  { href: '/marks', label: 'Marks entry', group: 'Teaching' },
  { href: '/timetable', label: 'Timetable', group: 'Teaching' },
  { href: '/class-desk', label: 'Class teacher desk', group: 'Teaching' },
  { href: '/leave', label: 'Leave', group: 'Teaching' },
  { href: '/substitutions', label: 'Substitutions', group: 'Teaching' },
  { href: '/messages', label: 'Messages', badge: 'messages', group: 'Talk' },
  { href: '/notices', label: 'Official notices', badge: 'notices', group: 'Talk' },
  { href: '/admin/staff-attendance', label: 'Staff attendance', roles: ['admin'], group: 'School office' },
  { href: '/admin/accounts', label: 'Accounts', roles: ['admin'], group: 'School office' },
  { href: '/admin/setup', label: 'School set-up', roles: ['admin'], group: 'School office' },
  { href: '/admin/exams', label: 'Exams & report cards', roles: ['admin'], group: 'School office' },
  { href: '/admin/promotions', label: 'Grade (std) changes', roles: ['admin'], group: 'School office' },
  { href: '/admin/reports', label: 'Reports', roles: ['admin'], group: 'School office' },
  { href: '/admin/moderation', label: 'Chat review', roles: ['admin'], group: 'School office' },
  { href: '/admin/consents', label: 'Guardian consents', roles: ['admin'], group: 'School office' },
  { href: '/admin/audit', label: 'Audit log', roles: ['admin'], group: 'School office' },
]
