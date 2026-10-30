import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Event records, adapting the schema from Neon's with-mcp template. */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  location: text("location"),
  description: text("description"),
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
