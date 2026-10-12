import { hashPassword, verifyPassword } from './password';
import { ACCOUNT_NAME_PATTERN, FIXED_ADMIN_ACCOUNT, FIXED_ADMIN_PASSWORD, validPassword } from './access.constants';

describe('password hashing', () => {
  it('accepts the password and rejects another without storing plaintext', async () => {
    const hash = await hashPassword('Aa123456!');
    expect(hash).not.toContain('Aa123456!');
    await expect(verifyPassword('Aa123456!', hash)).resolves.toBe(true);
    await expect(verifyPassword('Aa123456?', hash)).resolves.toBe(false);
  });

  it('keeps the fixed administrator compatible with the login policy', () => {
    expect(FIXED_ADMIN_ACCOUNT).toMatch(ACCOUNT_NAME_PATTERN);
    expect(validPassword(FIXED_ADMIN_PASSWORD)).toBe(true);
  });
});
