# Todo App Example

A minimal full-stack application demonstrating `hex-effect` in action.

## Structure

```
contexts/
  @projects/
    domain/       Aggregates, domain events, pure business logic
    application/  Use cases and abstract service ports
    infra/        SQL + NATS implementations, layer composition

  @badges/
    domain/       Badge aggregate, BadgeAwardedEvent, award logic
    application/  Use cases and abstract service ports
    infra/        SQL implementations, event handler, layer composition

web/              SvelteKit UI
```

---

## Bounded Context: @projects

### Domain Layer

Defines the ubiquitous language using Effect Schema. No framework dependencies, no IO.

**Aggregates and events:**

```
Project  { id: ProjectId, title: NonEmptyString }
  └─ ProjectCreatedEvent  { id: ProjectId }

Task     { id: TaskId, projectId: ProjectId, description: string, completed: boolean }
  └─ TaskAddedEvent     { id: TaskId, projectId: ProjectId }
  └─ TaskCompletedEvent { id: TaskId }
  └─ TaskRemovedEvent   { id: TaskId }
```

Domain functions take aggregates as input and return `[aggregate, event]` tuples — no persistence, no side effects.

### Application Layer

Orchestrates domain functions into named use cases. Declares abstract service ports (`SaveProject`, `FindProjectById`, etc.) as `Context.Tag` services — the application layer has no knowledge of SQL or NATS.

```typescript
// use-cases.ts
export const completeTask = (taskId: string) =>
  findOrNotFound(FindTaskById, TaskId.make(taskId)).pipe(
    Effect.flatMap((task) => Task.Service.complete(task)),
    Effect.tap(([task]) => Effect.serviceFunctions(UpdateTask).update(task)),
    Effect.map(([, event]) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );
```

`withTXBoundary` wraps the use case in a database transaction and ensures the returned domain event is durably stored before the transaction commits.

### Infrastructure Layer

Implements the abstract service ports as SQL queries. Composed with the shared `hex-effect` infrastructure via the `Live` layer.

---

## Bounded Context: @badges

Demonstrates two cross-domain communication patterns: asynchronous event consumption and a synchronous in-process query.

### Domain Layer

```
Badge    { id: BadgeId, badgeType: 'trailblazer'|'momentum'|'achiever', awardedAt: Date }
  └─ BadgeAwardedEvent  { badgeType }
```

Badge milestones are awarded based on total completed task count (global, across all projects):

| Count | Badge |
|-------|-------|
| 1  | trailblazer |
| 5  | momentum    |
| 10 | achiever    |

### Application Layer

**Service ports:**

- `GetCompletedTaskCount` — how many tasks are completed (answers a question owned by `@projects`, answered synchronously)
- `SaveBadge` — persist a badge record
- `GetAllBadges` — read all awarded badges for display

**Use cases:**

```typescript
// checkAndAwardBadges — called from the event handler
export const checkAndAwardBadges = Effect.gen(function* () {
  const count = yield* Effect.serviceFunctions(GetCompletedTaskCount).getCount();
  const badgeTypes = Badge.badgesForCount(count);
  return yield* Effect.forEach(badgeTypes, (type) =>
    Badge.awardBadge(type).pipe(
      Effect.tap(([badge]) => Effect.serviceFunctions(SaveBadge).save(badge)),
      Effect.map(([, event]) => event)
    )
  );
}).pipe(withTXBoundary(IsolationLevel.Batched));
```

### Infrastructure Layer

**`GetCompletedTaskCountLive`** — the synchronous cross-domain read:

```typescript
sql`SELECT COUNT(*) as count FROM tasks WHERE completed = 1;`
```

This queries the `tasks` table owned by `@projects`. Both contexts share the same LibSQL database in this deployment; the service port (`GetCompletedTaskCount`) is the anti-corruption layer that keeps `@badges/application` from knowing this detail.

**`BadgesInfraLive`** — registers the async cross-domain event handler:

```typescript
consumer.register(
  [Task.Model.TaskCompletedEvent],
  () => UseCases.checkAndAwardBadges.pipe(Effect.asVoid),
  { $durableName: 'badges-task-completed' }
);
```

---

## Data Flow: completing a task

```
Browser                  SvelteKit              LibSQL              NATS JetStream
  │                          │                     │                      │
  │── POST ?/completeTask ──▶│                     │                      │
  │                          │── completeTask() ──▶│                      │
  │                          │   (Batched TX)       │                      │
  │                          │   UPDATE tasks       │                      │
  │                          │   INSERT hex_effect_events (TaskCompletedEvent)
  │                          │◀── commit ───────────│                      │
  │                          │                      │                      │
  │◀── 200 OK ───────────────│                      │                      │
  │                          │                      │                      │
  │             [EventPublisherDaemon — background fiber]                  │
  │                          │── SELECT delivered=0 ▶│                     │
  │                          │◀── TaskCompletedEvent─│                     │
  │                          │── js.publish() ──────────────────────────▶ │
  │                          │── UPDATE delivered=1 ▶│                     │
  │                          │                      │                      │
  │             [badges-task-completed — NATS durable consumer]            │
  │                          │◀── TaskCompletedEvent ───────────────────── │
  │                          │                      │                      │
  │                          │── checkAndAwardBadges()                     │
  │                          │   SELECT COUNT(*) FROM tasks WHERE completed=1
  │                          │   (sync cross-domain read)                  │
  │                          │   INSERT badges + INSERT hex_effect_events (BadgeAwardedEvent)
  │                          │── ackAck() ──────────────────────────────▶ │
  │                          │                      │                      │
  │             [EventPublisherDaemon — next tick]                         │
  │                          │── js.publish(BadgeAwardedEvent) ──────────▶│
  │                          │── UPDATE delivered=1 ▶│                     │
  │                          │                      │                      │
  │── GET /projects/[id] ───▶│                      │                      │
  │                          │── getProjectWithTasks()                     │
  │                          │── getAllBadges() ─────▶│                    │
  │◀── {tasks, badges} ──────│                      │                      │
```

### Key guarantees

- **At-least-once delivery**: events are persisted in LibSQL before being published to NATS. If the process crashes between publish and `ackAck`, the event re-delivers.
- **Atomic badge award**: the `SELECT COUNT` query, `INSERT badges`, and `INSERT hex_effect_events` all happen inside a single `Batched` transaction. Either all commit or none do.
- **Startup drain**: the `EventPublisherDaemon` flushes any `delivered = 0` events on startup before listening for new commits, so events stranded by a previous crash are not lost.
- **Durable consumer**: `badges-task-completed` is a named JetStream consumer. Its position persists across restarts — no events are re-processed after a clean ack.

---

## Layer Composition

```
ManagedRuntime.make(Live)          ← one runtime per process

Live =
  MigrationsLive                   ← CREATE TABLE IF NOT EXISTS ...
  + EventHandlersLive (@projects)  ← logs task completions
  + BadgesInfraLive                ← awards badges on TaskCompletedEvent
  + BaseLive:
      WithTransactionLive          ← Batched / Serializable TX support
      EventConsumerLive            ← NatsEventConsumer as EventConsumer
      EventPublisherDaemon         ← outbox publisher fiber
      LibsqlSdk + LibsqlClient     ← database connection
      NatsClient + JetStream       ← messaging connection
      UUIDGenerator
```

Query services (used per-request) are provided separately:

```typescript
platform.runtime.runPromise(
  myUseCase.pipe(Effect.provide(ServiceLive))   // SQL read implementations
);
```

---

## Running Locally

```bash
# From repo root
pnpm install

# Start LibSQL and NATS:
docker run -d -p 8080:8080 ghcr.io/tursodatabase/libsql-server:main sqld --no-welcome --http-listen-addr 0.0.0.0:8080
docker run -d -p 4222:4222 nats:latest -js

# Start dev server:
DATABASE_URL=http://localhost:8080 NATS_SERVER=nats://localhost:4222 pnpm --filter web dev
```
