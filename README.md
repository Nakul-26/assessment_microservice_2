# Online Judge System

This project is a microservices-based online judge system for coding assessments. It allows users to submit code to solve programming problems and have it evaluated automatically.

## Architecture

The system is composed of three main services that communicate asynchronously:

- **`frontend`**: A React-based single-page application that provides the user interface for viewing problems, submitting code, and seeing the results.
- **`assessment-api`**: A Node.js/Express backend that serves as the main entry point for the frontend. It handles user submissions, manages problems, and provides status updates on submissions.
- **`judge-service-go`**: A Go service that acts as an asynchronous worker. It is responsible for securely executing user-submitted code in isolated Docker containers and evaluating the output against the problem's test cases. It is designed for high performance and scalability, using a container pool and `tmpfs` volumes to optimize execution time and resource usage.

### Service Communication

1.  **Frontend to API**: The frontend communicates with the `assessment-api` via standard REST API calls to submit code and poll for results.
2.  **API to Judge**: When a new submission is received, the `assessment-api` publishes a job to a **RabbitMQ** message queue (`submission_queue`).
3.  **Judge Service**: The `judge-service-go` consumes jobs from the queue, executes the code, and writes the results directly to a **MongoDB** database and a **Redis** cache.
4.  **Result Retrieval**: The `assessment-api` reads the results from the database/cache when the frontend polls for an update.

![Architecture Diagram](https://user-images.githubusercontent.com/1213322/153285329-3733c758-1815-4148-9f37-013e53697920.png)

## Key Technologies

- **Frontend**: React, Vite, Axios, React Router
- **Backend API**: Node.js, Express, Mongoose
- **Judge Service**: Go, Docker SDK
- **Messaging**: RabbitMQ
- **Database**: MongoDB
- **Caching**: Redis
- **Containerization**: Docker, Docker Compose

## Getting Started

The entire project is containerized and can be run easily using Docker Compose.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Running the Application

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd assessment_microservice_2
    ```

2.  Optional: if you want persistent cloud-backed data instead of the local Docker Mongo volume, create a root `.env` file with your Atlas connection string:
    ```bash
    MONGO_URI=mongodb+srv://<username>:<password>@<cluster>/<dbname>?retryWrites=true&w=majority
    ```

    The API and judge services will use `MONGO_URI` from `.env`. If it is not set, they fall back to the local `mongo` container.

3.  Build and start all the services:
    ```bash
    docker-compose up --build
    ```

This command will build the Docker images for each service and start the necessary containers for the application and its infrastructure. If `MONGO_URI` is set to Atlas, the local `mongo` container may still start, but application data will be stored in Atlas instead of the local Docker volume.

4.  Seed some starter problems:
    ```bash
    npm run seed:problems
    ```

    This runs the seeding script inside the running `assessment-api` container, so it uses the same network and environment as the API service itself.

Once everything is running, you can access the services at the following locations:

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **API**: [http://localhost:3000](http://localhost:3000)

You can verify seeded problems with:

```bash
curl http://localhost:3000/api/problems
```


# for clean up:

'''
docker system prune -a --volumes -f
docker builder prune -a -f
docker rm -f $(docker ps -aq)
'''
