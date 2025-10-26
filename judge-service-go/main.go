package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/redis/go-redis/v9"

	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/wrapper"
)

const (
	defaultRabbitMQURL     = "amqp://user:password@rabbitmq:5672"
	defaultSubmissionQueue = "submission_queue"
	defaultResultQueue     = "submission_results"
	defaultMongoURI        = "mongodb://mongo:27017/assessment_db"
	defaultRedisURI        = "redis://redis:6379"
	defaultSandboxTimeout  = 5 * time.Second
)

func failOnError(err error, msg string) {
	if err != nil {
		log.Panicf("%s: %s", msg, err)
	}
}

// TestResult represents the result of a single test case
type TestResult struct {
	Test      int         `json:"test"`
	Ok        bool        `json:"ok"`
	Output    interface{} `json:"output,omitempty"`
	Error     string      `json:"error,omitempty"`
	Stack     string      `json:"stack,omitempty"`
	Traceback string      `json:"traceback,omitempty"`
}

// SubmissionResult represents the overall result of a submission
type SubmissionResult struct {
	Status  string       `json:"status"`
	Passed  int          `json:"passed"`
	Total   int          `json:"total"`
	Details []TestResult `json:"details"`
}

func main() {
	fmt.Println("Go Judge Service starting...")

	// Load environment variables or use defaults
	rabbitmqURL := os.Getenv("RABBITMQ_URL")
	if rabbitmqURL == "" {
		rabbitmqURL = defaultRabbitMQURL
	}
	submissionQueueName := os.Getenv("SUBMISSION_QUEUE")
	if submissionQueueName == "" {
		submissionQueueName = defaultSubmissionQueue
	}
	resultQueueName := os.Getenv("RESULT_QUEUE")
	if resultQueueName == "" {
		resultQueueName = defaultResultQueue
	}
	mongoURI := os.Getenv("MONGO_URI")
	if mongoURI == "" {
		mongoURI = defaultMongoURI
	}
	redisURI := os.Getenv("REDIS_URI")
	if redisURI == "" {
		redisURI = defaultRedisURI
	}

	// Initialize Docker Executor
	executor, err := executor.NewExecutor()
	failOnError(err, "Failed to create Docker executor")

	// Connect to MongoDB
	mongoClient, err := mongo.Connect(context.Background(), options.Client().ApplyURI(mongoURI))
	failOnError(err, "Failed to connect to MongoDB")
	defer func() {
		if err = mongoClient.Disconnect(context.Background()); err != nil {
			log.Printf("Error disconnecting from MongoDB: %v", err)
		}
	}()

	problemsCollection := mongoClient.Database("assessment_db").Collection("problems")
	submissionsCollection := mongoClient.Database("assessment_db").Collection("submissions")

	// Normalize Redis address: accept either "host:port" or full URI like "redis://host:port"
	redisAddr := redisURI
	if strings.HasPrefix(redisURI, "redis://") {
		if u, err := url.Parse(redisURI); err == nil {
			redisAddr = u.Host
		} else {
			// fallback: strip the prefix
			redisAddr = strings.TrimPrefix(redisURI, "redis://")
		}
	}

	// Initialize Redis Client
	redisClient := redis.NewClient(&redis.Options{
		Addr: redisAddr,
		DB:   0, // use default DB
	})
	_, err = redisClient.Ping(context.Background()).Result()
	failOnError(err, "Failed to connect to Redis")

	// We will generate wrapper content on each submission using pkg/wrapper.GenerateWrapper

	// Connect to RabbitMQ
	conn, err := amqp.Dial(rabbitmqURL)
	failOnError(err, "Failed to connect to RabbitMQ")
	defer conn.Close()

	ch, err := conn.Channel()
	failOnError(err, "Failed to open a channel")
	defer ch.Close()

	_, err = ch.QueueDeclare(
		submissionQueueName, // name
		true,                // durable
		false,               // delete when unused
		false,               // exclusive
		false,               // no-wait
		nil,                 // arguments
	)
	failOnError(err, "Failed to declare submission queue")

	_, err = ch.QueueDeclare(
		resultQueueName, // name
		true,            // durable
		false,           // delete when unused
		false,           // exclusive
		false,           // no-wait
		nil,             // arguments
	)
	failOnError(err, "Failed to declare result queue")

	msgs, err := ch.Consume(
		submissionQueueName, // queue
		"",                  // consumer
		false,               // auto-ack - set to false for manual ack
		false,               // exclusive
		false,               // no-local
		false,               // no-wait
		nil,                 // args
	)
	failOnError(err, "Failed to register a consumer")

	log.Printf(" [*] Waiting for messages in %s. To exit press CTRL+C", submissionQueueName)

	forever := make(chan struct{})

	go func() {
		for d := range msgs {
			log.Printf("Received a message: %s", d.Body)

			// First unmarshal into a generic map and perform lightweight validation
			var rawMsg map[string]interface{}
			if err := json.Unmarshal(d.Body, &rawMsg); err != nil {
				log.Printf("Error unmarshalling raw submission message: %v", err)
				d.Nack(false, false)
				continue
			}
			// validate required fields
			if rawMsg["submissionId"] == nil || rawMsg["problemId"] == nil || rawMsg["language"] == nil || rawMsg["code"] == nil {
				log.Printf("Invalid submission message, missing required fields: %v", rawMsg)
				d.Nack(false, false)
				continue
			}

			var submissionMsg struct {
				SubmissionID string `json:"submissionId"`
				ProblemID    string `json:"problemId"`
				Language     string `json:"language"`
				Code         string `json:"code"`
				FunctionName string `json:"functionName"`
			}
			if err := json.Unmarshal(d.Body, &submissionMsg); err != nil {
				log.Printf("Error unmarshalling submission message into struct: %v", err)
				d.Nack(false, false)
				continue
			}

			log.Printf("Processing submission %s for problem %s in %s", submissionMsg.SubmissionID, submissionMsg.ProblemID, submissionMsg.Language)

			// Fetch Problem from MongoDB
			objID, err := primitive.ObjectIDFromHex(submissionMsg.ProblemID)
			if err != nil {
				log.Printf("Invalid ProblemID: %v", err)
				d.Nack(false, false)
				continue
			}
			var problem models.Problem
			// First fetch raw document to inspect types (helps debug mismatched schemas)
			var raw bson.M
			err = problemsCollection.FindOne(context.Background(), bson.M{"_id": objID}).Decode(&raw)
			if err != nil {
				log.Printf("Error fetching raw problem %s: %v", submissionMsg.ProblemID, err)
				d.Nack(false, false)
				continue
			}
			// Log type info for testCases[0].input if available
			if tcArr, ok := raw["testCases"].([]interface{}); ok && len(tcArr) > 0 {
				if first, ok := tcArr[0].(map[string]interface{}); ok {
					if in, ok := first["input"]; ok {
						log.Printf("Raw problem testCases[0].input type: %T", in)
					}
				}
			}

			// Now decode into the typed struct
			// Re-marshal raw into bytes and unmarshal into models.Problem to avoid double-decoding surprises
			rawBytes, _ := json.Marshal(raw)
			if err := json.Unmarshal(rawBytes, &problem); err != nil {
				log.Printf("Error decoding problem %s into model: %v", submissionMsg.ProblemID, err)
				d.Nack(false, false)
				continue
			}

			lang, ok := languages.Languages[submissionMsg.Language]
			if !ok {
				log.Printf("Unsupported language: %s", submissionMsg.Language)
				d.Nack(false, false)
				continue
			}

			// Generate wrapper using wrapper.GenerateWrapper which parses TestCases and fills TESTS_JSON
			finalTemplate, err := wrapper.GenerateWrapper(problem, lang)
			if err != nil {
				log.Printf("Failed to generate wrapper for language %s: %v", lang.ID, err)
				d.Nack(false, false)
				continue
			}

			// Determine function/class name to inject (submission overrides problem default)
			funcName := submissionMsg.FunctionName
			if funcName == "" && problem.FunctionName != nil {
				if n, ok := problem.FunctionName[lang.ID]; ok {
					funcName = n
				}
			}

			// Ensure placeholders are present or replaced (no-op if not found)
			if funcName != "" {
				finalTemplate = strings.ReplaceAll(finalTemplate, "{{FUNCTION_NAME}}", funcName)
				finalTemplate = strings.ReplaceAll(finalTemplate, "{{CLASS_NAME}}", funcName)
			}

			// Insert user code at marker(s)
			finalCode := strings.Replace(finalTemplate, "// USER_CODE_MARKER", submissionMsg.Code, 1)
			finalCode = strings.Replace(finalCode, "# USER_CODE_MARKER", submissionMsg.Code, 1)

			// Run submission in Docker
			stdout, stderr, execErr := executor.RunSubmission(
				context.Background(),
				lang.Image,
				finalCode,
				"submission"+lang.FileExt,
				lang.RunCmd,
				defaultSandboxTimeout,
			)

			log.Printf("Execution finished for submission %s. Stdout: %s, Stderr: %s, Error: %v", submissionMsg.SubmissionID, stdout, stderr, execErr)

			// Process results
			var result SubmissionResult
			submissionStatus := "Error"
			submissionOutput := stderr
			submissionTestResult := interface{}(nil)

			// Prefer parsing stdout if present (the wrapper may emit structured JSON even on non-zero exit)
			if stdout != "" {
				if err := json.Unmarshal([]byte(stdout), &result); err == nil {
					submissionTestResult = result
					// Normalize status values from the wrapper to our canonical statuses
					s := strings.ToLower(result.Status)
					switch s {
					case "finished":
						if result.Passed == result.Total {
							submissionStatus = "Success"
						} else {
							submissionStatus = "Fail"
						}
					case "error":
						submissionStatus = "Error"
					case "fail":
						submissionStatus = "Fail"
					case "success":
						submissionStatus = "Success"
					default:
						// fallback to the raw status string (but capitalize first letter for consistency)
						if result.Status != "" {
							submissionStatus = strings.Title(result.Status)
						} else {
							submissionStatus = "Error"
						}
					}
					submissionOutput = stdout
				} else {
					log.Printf("Error unmarshalling stdout to result: %v, Stdout: %s", err, stdout)
					// If execErr exists, include it in the output for debugging
					if execErr != nil {
						submissionOutput = fmt.Sprintf("Execution Error: %v\nInvalid judge output: %v\nStdout: %s\nStderr: %s", execErr, err, stdout, stderr)
					} else {
						submissionOutput = fmt.Sprintf("Invalid judge output: %v\nStdout: %s", err, stdout)
					}
					submissionStatus = "Error"
				}

			} else if execErr != nil {
				submissionStatus = "Error"
				submissionOutput = fmt.Sprintf("Execution Error: %v\nStderr: %s", execErr, stderr)

			} else if stderr != "" {
				submissionStatus = "Error"
				submissionOutput = stderr
			}

			// Update submission status in MongoDB
			submissionObjID, err := primitive.ObjectIDFromHex(submissionMsg.SubmissionID)
			if err != nil {
				log.Printf("Invalid SubmissionID: %v", err)
				d.Nack(false, false)
				continue
			}

			update := bson.M{
				"$set": bson.M{
					"status":     submissionStatus,
					"output":     submissionOutput,
					"testResult": submissionTestResult,
					"updatedAt":  time.Now(),
				},
			}
			_, err = submissionsCollection.UpdateByID(context.Background(), submissionObjID, update)
			if err != nil {
				log.Printf("Error updating submission %s in MongoDB: %v", submissionMsg.SubmissionID, err)
			}

			// Store updated submission in Redis
			updatedSubmission := models.Submission{
				ID:         submissionObjID,
				ProblemID:  objID,
				Language:   submissionMsg.Language,
				Code:       submissionMsg.Code,
				Status:     submissionStatus,
				Output:     submissionOutput,
				TestResult: submissionTestResult,
				UpdatedAt:  time.Now(),
			}
			// Fetch the original submission to get CreatedAt and UserID if needed
			var originalSubmission models.Submission
			err = submissionsCollection.FindOne(context.Background(), bson.M{"_id": submissionObjID}).Decode(&originalSubmission)
			if err == nil {
				updatedSubmission.CreatedAt = originalSubmission.CreatedAt
				updatedSubmission.UserID = originalSubmission.UserID
			}

			jsonSubmission, err := json.Marshal(updatedSubmission)
			if err != nil {
				log.Printf("Error marshalling updated submission to JSON for Redis: %v", err)
			} else {
				redisClient.Set(context.Background(), fmt.Sprintf("submission:%s", submissionMsg.SubmissionID), jsonSubmission, 3600*time.Second)
			}

			// Publish results to RabbitMQ
			resultMsg := struct {
				SubmissionID string      `json:"submissionId"`
				Language     string      `json:"language"`
				Result       interface{} `json:"result"`
				Timestamp    int64       `json:"timestamp"`
			}{
				SubmissionID: submissionMsg.SubmissionID,
				Language:     submissionMsg.Language,
				Result:       submissionTestResult,
				Timestamp:    time.Now().UnixMilli(),
			}
			jsonResultMsg, err := json.Marshal(resultMsg)
			if err != nil {
				log.Printf("Error marshalling result message to JSON: %v", err)
			} else {
				err = ch.Publish(
					"",              // exchange
					resultQueueName, // routing key
					false,           // mandatory
					false,           // immediate
					amqp.Publishing{
						ContentType:  "application/json",
						Body:         jsonResultMsg,
						DeliveryMode: amqp.Persistent,
					},
				)
				if err != nil {
					log.Printf("Error publishing result message to RabbitMQ: %v", err)
				}
			}

			d.Ack(false)
		}
	}()

	<-forever
}
