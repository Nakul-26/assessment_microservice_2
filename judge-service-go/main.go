package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
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

func processSubmission(d amqp.Delivery, problemsCollection *mongo.Collection, submissionsCollection *mongo.Collection, redisClient *redis.Client, ch *amqp.Channel, resultQueueName string, executor *executor.Executor) {
	log.Printf("Received a message: %s", d.Body)

	var submissionMsg struct {
		SchemaVersion string `json:"schemaVersion"`
		SubmissionID  string `json:"submissionId"`
		ProblemID     string `json:"problemId"`
		Language      string `json:"language"`
		Code          string `json:"code"`
		FunctionName  string `json:"functionName"`
		Tests         []struct {
			Input          []interface{} `json:"input"`
			ExpectedOutput interface{}   `json:"expectedOutput"`
		} `json:"tests"`
	}

	if err := json.Unmarshal(d.Body, &submissionMsg); err != nil {
		log.Printf("Error unmarshalling submission message: %v", err)
		d.Nack(false, false)
		return
	}

	if submissionMsg.SubmissionID == "" || submissionMsg.ProblemID == "" || submissionMsg.Language == "" || submissionMsg.Code == "" || submissionMsg.FunctionName == "" {
		log.Printf("Invalid submission message, missing required fields: %+v", submissionMsg)
		d.Nack(false, false)
		return
	}

	log.Printf("Processing submission %s for problem %s in %s", submissionMsg.SubmissionID, submissionMsg.ProblemID, submissionMsg.Language)

	// Fetch Problem from MongoDB
	objID, err := primitive.ObjectIDFromHex(submissionMsg.ProblemID)
	if err != nil {
		log.Printf("Invalid ProblemID: %v", err)
		d.Nack(false, false)
		return
	}
	var problem models.Problem
	err = problemsCollection.FindOne(context.Background(), bson.M{"_id": objID}).Decode(&problem)
	if err != nil {
		log.Printf("Error fetching problem %s: %v", submissionMsg.ProblemID, err)
		d.Nack(false, false)
		return
	}

	lang, ok := languages.Languages[submissionMsg.Language]
	if !ok {
		log.Printf("Unsupported language: %s", submissionMsg.Language)
		d.Nack(false, false)
		return
	}

	// Create a temporary directory for the execution
	tempDir, err := os.MkdirTemp("", "submission-")
	if err != nil {
		log.Printf("Failed to create temp dir: %v", err)
		d.Nack(false, false)
		return
	}
	defer os.RemoveAll(tempDir)

	// Marshal test cases to JSON from the submission message itself
	testsJSON, err := json.Marshal(submissionMsg.Tests)
	if err != nil {
		log.Printf("Failed to marshal test cases to JSON: %v", err)
		d.Nack(false, false)
		return
	}

	// Populate problem.TestsJSON
	problem.TestsJSON = testsJSON

	// Generate wrapper code
	wrapperCode, err := wrapper.GenerateWrapper(problem, lang)
	if err != nil {
		log.Printf("Failed to generate wrapper: %v", err)
		d.Nack(false, false)
		return
	}

	// For Java, generateJavaFunctionCall returns a string with {{CLASS_NAME}} and {{FUNCTION_NAME}}
	// These need to be replaced here.
	if lang.ID == "java" {
		wrapperCode = strings.ReplaceAll(wrapperCode, "{{CLASS_NAME}}", submissionMsg.FunctionName)
		wrapperCode = strings.ReplaceAll(wrapperCode, "{{FUNCTION_NAME}}", submissionMsg.FunctionName)
	}

	var filesToCopy []string
	if lang.ID == "javascript" {
		submissionFileName := "submission.js"
		wrapperFileName := "wrapper.js"
		submissionCode := submissionMsg.Code + "\nmodule.exports = { " + submissionMsg.FunctionName + " };"
		if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(submissionCode), 0644); err != nil {
			log.Printf("Failed to write submission file: %v", err)
			d.Nack(false, false)
			return
		}
		if err := os.WriteFile(filepath.Join(tempDir, wrapperFileName), []byte(wrapperCode), 0644); err != nil {
			log.Printf("Failed to write wrapper file: %v", err)
			d.Nack(false, false)
			return
		}
		filesToCopy = []string{submissionFileName, wrapperFileName}
	} else {
		finalCode := strings.Replace(wrapperCode, "// USER_CODE_MARKER", submissionMsg.Code, 1)
		finalCode = strings.Replace(finalCode, "# USER_CODE_MARKER", submissionMsg.Code, 1)
		submissionFileName := "submission" + lang.FileExt
		if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(finalCode), 0644); err != nil {
			log.Printf("Failed to write combined submission file: %v", err)
			d.Nack(false, false)
			return
		}
		filesToCopy = []string{submissionFileName}
	}

	// Run submission in Docker
	stdout, stderr, execErr := executor.RunSubmission(
		context.Background(),
		lang.Image,
		filesToCopy,
		tempDir,
		lang.CompileCmd,
		lang.RunCmd,
		defaultSandboxTimeout,
	)

	log.Printf("Execution finished for submission %s. Stdout: %s, Stderr: %s, Error: %v", submissionMsg.SubmissionID, stdout, stderr, execErr)

	// Process results
	var result models.SubmissionResult
	submissionStatus := "Error"
	submissionOutput := stderr
	submissionTestResult := interface{}(nil)

	if stdout != "" {
		if err := json.Unmarshal([]byte(stdout), &result); err == nil {
			submissionTestResult = result
			s := strings.ToLower(result.Status)
			switch s {
			case "finished":
				if result.Passed == result.Total {
					submissionStatus = "Success"
				} else {
					submissionStatus = "Fail"
				}
			case "error", "fail":
				submissionStatus = strings.Title(s)
			case "success":
				submissionStatus = "Success"
			default:
				submissionStatus = "Error"
			}
			submissionOutput = stdout
		} else {
			log.Printf("Error unmarshalling stdout to result: %v, Stdout: %s", err, stdout)
			submissionOutput = fmt.Sprintf("Invalid judge output: %v\nStdout: %s", err, stdout)
			if execErr != nil {
				submissionOutput += fmt.Sprintf("\nExecution Error: %v\nStderr: %s", execErr, stderr)
			}
			submissionStatus = "Error"
		}
	} else if execErr != nil {
		submissionStatus = "Error"
		submissionOutput = fmt.Sprintf("Execution Error: %v\nStderr: %s", execErr, stderr)
	}

	// Update submission status in MongoDB
	submissionObjID, err := primitive.ObjectIDFromHex(submissionMsg.SubmissionID)
	if err != nil {
		log.Printf("Invalid SubmissionID: %v", err)
		d.Nack(false, false)
		return
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
	var originalSubmission models.Submission
	if err = submissionsCollection.FindOne(context.Background(), bson.M{"_id": submissionObjID}).Decode(&originalSubmission); err == nil {
		updatedSubmission.CreatedAt = originalSubmission.CreatedAt
		updatedSubmission.UserID = originalSubmission.UserID
	}

	jsonSubmission, err := json.Marshal(updatedSubmission)
	if err == nil {
		redisClient.Set(context.Background(), fmt.Sprintf("submission:%s", submissionMsg.SubmissionID), jsonSubmission, 3600*time.Second)
	}

	d.Ack(false)
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
			processSubmission(d, problemsCollection, submissionsCollection, redisClient, ch, resultQueueName, executor)
		}
	}()

	<-forever
}
