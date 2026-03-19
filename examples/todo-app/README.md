# Todo App Example

A minimal full-stack application demonstrating `hex-effect` in action.

## Structure

```
contexts/
  @projects/
    domain/       Aggregates, domain events, pure business logic
    application/  Use cases and abstract service ports
    infra/        SQL + NATS implementations, layer composition

web/              SvelteKit UI
```

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
```

Domain functions take aggregates as input and return `[aggregate, event]` tuples — no persistence, no side effects.

### Application Layer

Orchestrates domain functions into named use cases. Declares abstract service ports (`SaveProject`, `FindProjectById`, etc.) as `Context.Tag` services — the application layer has no knowledge of SQL or NATS.

```typescript
// use-cases.ts
export const createProject = (title: string) =>
  Effect.gen(function* () {
    const [project, event] = yield* Project.Service.createProject(title);
    yield* Effect.serviceFunctions(SaveProject).save(project);
    return [event];
  }).pipe(withTXBoundary(IsolationLevel.Batched));
```

`withTXBoundary` wraps the use case in a database transaction and ensures the returned domain event is durably stored before the transaction commits.

### Infrastructure Layer

Implements the abstract service ports and composes everything into a `Live` layer:

```typescript
// Provide environment-specific config:
const ConfigLive = Layer.mergeAll(
  Layer.succeed(LibsqlConfig, { config: Config.all({ url: Config.string('DATABASE_URL') }) }),
  Layer.succeed(NatsConfig, {
    config: Config.all({ servers: Config.string('NATS_SERVER') }),
    appNamespace: Config.succeed('projects-app')
  })
);

export const Live = Layer.mergeAll(
  SaveProjectLive,
  GetAllProjectsLive,
  // ... other service implementations ...
  hex.Live
).pipe(Layer.provide(ConfigLive));
```

`hex.Live` (from `@hex-effect/infra-libsql-nats`) provides `WithTransaction`, `EventConsumer`, and the `EventPublisherDaemon`.

## Web Layer

The SvelteKit app creates a single `ManagedRuntime` from the infrastructure `Live` layer in `hooks.server.ts`:

```typescript
// hooks.server.ts
export const handle = async ({ event, resolve }) => {
  if (!globalPlatform) {
    globalPlatform = { runtime: ManagedRuntime.make(Live) };
  }
  event.platform = globalPlatform;
  return resolve(event);
};
```

Server load functions and form actions run use cases through the runtime:

```typescript
// +page.server.ts
export const load = async ({ platform }) => {
  const projects = await platform!.runtime.runPromise(
    UseCases.getAllProjects.pipe(Effect.provide(ServiceLive))
  );
  return { projects };
};
```

## Running Locally

```bash
# From repo root
pnpm install

# Start LibSQL and NATS (example using Docker):
docker run -d -p 8080:8080 ghcr.io/tursodatabase/libsql-server:main sqld --no-welcome --http-listen-addr 0.0.0.0:8080
docker run -d -p 4222:4222 nats:latest -js

# Set env vars and start dev server:
DATABASE_URL=http://localhost:8080 NATS_SERVER=nats://localhost:4222 pnpm dev
```
