const SUPERUSER_EMAILS = [
  "ultimate.easy.address@gmail.com",
  "simona.fiorani@pubimentor.com",
];

export function isSuperuser(email: string | null | undefined): boolean {
  return !!email && SUPERUSER_EMAILS.includes(email.toLowerCase());
}
