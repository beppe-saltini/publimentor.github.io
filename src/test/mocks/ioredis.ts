/** Vitest stub for optional ioredis dependency */
export default class Redis {
  constructor() {}
  async connect() {}
  async incr() {
    return 1;
  }
  async expire() {}
  async ttl() {
    return 60;
  }
  async quit() {}
}
