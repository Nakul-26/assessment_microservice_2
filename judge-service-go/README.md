# Go Judge Service

This service is responsible for executing code submissions in a sandboxed environment. It listens for submission messages from a RabbitMQ queue, executes the code in a Docker container, and reports the results back to the main application.

## Architecture

The judge service is designed for scalability and performance. It uses a container pool to avoid the overhead of creating a new Docker container for each submission. It also uses `tmpfs` volumes for fast file I/O between the judge and the containers.

The main components of the architecture are:

- **Container Pool:** A pool of pre-warmed Docker containers for each supported language. This avoids the cost of creating and destroying containers for each submission.
- **`tmpfs` Volumes:** Each container in the pool is mounted with a `tmpfs` volume. This allows the judge to write submission files directly to a host path that the container can see instantly, avoiding the overhead of copying files using `tar`.
- **Parallel Execution:** The service processes multiple submissions in parallel using goroutines, up to a configurable number of workers.

## Running the Service

The service is designed to be run with Docker Compose. The `docker-compose.yml` file in the root of the project defines the judge service along with its dependencies (RabbitMQ, MongoDB, Redis).

To run the service, use the following command from the root of the project:

```bash
docker-compose up --build judge-service-go
```

## Configuration

The following environment variables can be used to configure the service:

| Variable               | Description                                     | Default                               |
| ---------------------- | ----------------------------------------------- | ------------------------------------- |
| `RABBITMQ_URL`         | The URL of the RabbitMQ server.                 | `amqp://user:password@rabbitmq:5672`  |
| `SUBMISSION_QUEUE`     | The name of the submission queue.               | `submission_queue`                    |
| `MONGO_URI`            | The URI of the MongoDB server.                  | `mongodb://mongo:27017/assessment_db` |
| `REDIS_URI`            | The URI of the Redis server.                    | `redis://redis:6379`                  |
| `DEFAULT_POOL_SIZE`    | The number of containers to create per language.| `2` |
| `JUDGE_USER`           | The user to run the code as in the container.   | `""` (image default)                  |
| `JUDGE_UID`            | The user ID to run the code as in the container.| `""` (image default)                  |

