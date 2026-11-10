import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "~/db/schema";
import type {
  ArchiveRequest,
  NotificationDelivery,
  NotificationTransport,
} from "~/lib/notifications.server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Creates a fresh in-memory SQLite database with all tables for testing.
 * Each call returns a new isolated database instance.
 *
 * Uses the same Drizzle migrations as the live database, ensuring
 * test and production schemas are always in sync.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const testDb = drizzle(sqlite, { schema });

  migrate(testDb, { migrationsFolder });

  return testDb;
}

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export function seedBaseData(testDb: ReturnType<typeof createTestDb>) {
  const user = testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  const instructor = testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();

  const category = testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: "## Test Course\n\nSales copy for the test course.",
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();

  return { user, instructor, category, course };
}

/**
 * Adds a user with a unique email derived from their name, for tests that need
 * people beyond the base seed.
 */
export function addUser(
  testDb: ReturnType<typeof createTestDb>,
  name: string,
  role: schema.UserRole = schema.UserRole.Student
) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      role,
    })
    .returning()
    .get();
}

export function addStudent(
  testDb: ReturnType<typeof createTestDb>,
  name: string
) {
  return addUser(testDb, name, schema.UserRole.Student);
}

export function addAdmin(
  testDb: ReturnType<typeof createTestDb>,
  name: string
) {
  return addUser(testDb, name, schema.UserRole.Admin);
}

/**
 * A Notification transport that records what it was asked to send and archive,
 * for tests at the Notifications seam.
 */
export function fakeNotificationTransport() {
  const sent: NotificationDelivery[] = [];
  const archived: ArchiveRequest[] = [];
  const transport: NotificationTransport = {
    async send(delivery) {
      sent.push(delivery);
    },
    async archive(archive) {
      archived.push(archive);
    },
  };

  return { sent, archived, transport };
}
