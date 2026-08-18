import { pino } from 'pino';

// Same structured-JSON shape as the monolith (service.name + component + numeric
// level + epoch-ms time) so the shared Logstash pipeline parses and indexes our
// logs identically. See config/logstash/logstash.conf.
export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: { name: 'notification-service' }, component: 'notification' },
});
