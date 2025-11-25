package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	defaultMongoURI        = "mongodb://mongo:27017/assessment_db"
	defaultRedisURI        = "redis://redis:6379"
	defaultSandboxTimeout  = 5 * time.Second
	maxTestsBytes          = 1 << 20 // 1MB
)

func toSnakeCase(str string) string {
	var matchFirstCap = regexp.MustCompile("(.)([A-Z][a-z]+)")
	var matchAllCap = regexp.MustCompile("([a-z0-9])([A-Z])")

	snake := matchFirstCap.ReplaceAllString(str, "${1}_${2}")
	snake = matchAllCap.ReplaceAllString(snake, "${1}_${2}")
	return strings.ToLower(snake)
}

func failOnError(err error, msg string) {
	if err != nil {
		log.Panicf("%s: %s", msg, err)
	}
}

// validateAndDecodeSubmission unmarshals and validates the submission message.
func validateAndDecodeSubmission(d amqp.Delivery) (models.SubmissionMessage, error) {
	var msg models.SubmissionMessage
	if err := json.Unmarshal(d.Body, &msg); err != nil {
		return msg, fmt.Errorf("error unmarshalling submission message: %w", err)
	}

	// Log ASAP, but validation will catch missing ID.
	log.Printf("[submission=%s] Received a message", msg.SubmissionID)

	if err := msg.Validate(); err != nil {
		return msg, fmt.Errorf("invalid submission message: %w", err)
	}

	sanitizedName, ok := msg.SanitizeFunctionName()
	if !ok {
		log.Printf("[submission=%s] sanitized function name %q -> %q", msg.SubmissionID, msg.FunctionName, sanitizedName)
		msg.FunctionName = sanitizedName
	}

	if msg.Language == "python" {
		msg.FunctionName = toSnakeCase(msg.FunctionName)
	}

	return msg, nil
}

// fetchProblemData retrieves the problem details from MongoDB.
func fetchProblemData(ctx context.Context, problemsCollection *mongo.Collection, problemID string) (models.Problem, error) {
	var problem models.Problem
	objID, err := primitive.ObjectIDFromHex(problemID)
	if err != nil {
		return problem, fmt.Errorf("invalid ProblemID: %w", err)
	}

	err = problemsCollection.FindOne(ctx, bson.M{"_id": objID}).Decode(&problem)
	if err != nil {
		return problem, fmt.Errorf("error fetching problem %s: %w", problemID, err)
	}
	return problem, nil
}

// prepareSubmissionFiles generates the necessary wrapper and source files for execution.
func prepareSubmissionFiles(submissionMsg models.SubmissionMessage, problem models.Problem, lang *languages.Language, tempDir string) ([]string, []string, []string, error) {
	// The problem's TestCases have been parsed and normalized by ValidateBasic().
	// We re-marshal them here to pass the clean JSON to the wrapper.
	testsJSON, err := json.Marshal(problem.TestCases)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to marshal normalized test cases to JSON: %w", err)
	}
	if len(testsJSON) > maxTestsBytes {
		return nil, nil, nil, fmt.Errorf("tests JSON too large after normalization: %d bytes", len(testsJSON))
	}
	problem.TestsJSON = testsJSON

	// The submission message provides the function name used in the user's code.
	wrapperCode, err := wrapper.GenerateWrapper(problem, lang, submissionMsg.FunctionName)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to generate wrapper: %w", err)
	}

	compareMode := submissionMsg.CompareMode
	if compareMode == "" {
		compareMode = "STRUCTURAL" // Default compare mode
	}
	wrapperCode = strings.ReplaceAll(wrapperCode, "{{COMPARE_MODE}}", compareMode)


	var filesToCopy []string
	compileCmd := lang.CompileCmd
	runCmd := lang.RunCmd

	// This large block can also be refactored further into language-specific file generators
	if lang.ID == "javascript" {
		submissionFileName := "submission.js"
		wrapperFileName := "wrapper.js"
		submissionCode := submissionMsg.Code + "\nmodule.exports = { " + submissionMsg.FunctionName + " };"
		if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(submissionCode), 0644); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to write submission file: %w", err)
		}
		if err := os.WriteFile(filepath.Join(tempDir, wrapperFileName), []byte(wrapperCode), 0644); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to write wrapper file: %w", err)
		}
		filesToCopy = []string{submissionFileName, wrapperFileName}
	} else {
		finalCode := strings.Replace(wrapperCode, "// USER_CODE_MARKER", submissionMsg.Code, 1)
		finalCode = strings.Replace(finalCode, "# USER_CODE_MARKER", submissionMsg.Code, 1)

		switch lang.ID {
		case "java":
			solutionFileName := "Solution.java"
			if err := os.WriteFile(filepath.Join(tempDir, solutionFileName), []byte(submissionMsg.Code), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write solution file: %w", err)
			}
			submissionFileName := "GeneratedTester.java"
			if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(wrapperCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{solutionFileName, submissionFileName}
		case "python":
			submissionFileName := "wrapper.py"
			solutionFileName := "solution.py"
			if err := os.WriteFile(filepath.Join(tempDir, solutionFileName), []byte(submissionMsg.Code), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write solution file: %w", err)
			}
			if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(finalCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{submissionFileName, solutionFileName}
		default: // C, CSharp, etc.
			submissionFileName := "main" + lang.FileExt
			if err := os.WriteFile(filepath.Join(tempDir, submissionFileName), []byte(finalCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{submissionFileName}
		}
	}

	return filesToCopy, compileCmd, runCmd, nil
}

// processAndStoreResults processes the executor output and updates the database and cache.
func processAndStoreResults(ctx context.Context, stdout, stderr string, execErr error, submissionMsg models.SubmissionMessage, submissionsCollection *mongo.Collection, redisClient *redis.Client) {
	var result models.SubmissionResult
	submissionStatus := models.StatusError
	submissionOutput := stderr
	var submissionTestResult *models.SubmissionResult

	if stdout != "" {
		if err := json.Unmarshal([]byte(stdout), &result); err == nil {
			submissionTestResult = &result
			s := strings.ToLower(result.Status)
			switch s {
			case models.StatusFinished:
				if result.Passed == result.Total {
					submissionStatus = models.StatusSuccess
				} else {
					submissionStatus = models.StatusFail
				}
			case "error":
				submissionStatus = models.StatusError
			case "fail":
				submissionStatus = models.StatusFail
			case "success":
				submissionStatus = models.StatusSuccess
			default:
				submissionStatus = models.StatusError
			}
			submissionOutput = stdout
		} else {
			log.Printf("[submission=%s] Error unmarshalling stdout to result: %v, Stdout: %s", submissionMsg.SubmissionID, err, stdout)
			submissionOutput = fmt.Sprintf("Invalid judge output: %v\nStdout: %s", err, stdout)
			if execErr != nil {
				submissionOutput += fmt.Sprintf("\nExecution Error: %v\nStderr: %s", execErr, stderr)
			}
		}
	} else if execErr != nil {
		submissionOutput = fmt.Sprintf("Execution Error: %v\nStderr: %s", execErr, stderr)
	}

	submissionObjID, err := primitive.ObjectIDFromHex(submissionMsg.SubmissionID)
	if err != nil {
		log.Printf("[submission=%s] Invalid SubmissionID for result update: %v", submissionMsg.SubmissionID, err)
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
	_, err = submissionsCollection.UpdateByID(ctx, submissionObjID, update)
	if err != nil {
		log.Printf("[submission=%s] Error updating submission in MongoDB: %v", submissionMsg.SubmissionID, err)
		// Not returning error, as we will still try to update Redis
	}

	// Fetch full submission to get CreatedAt and UserID for Redis
	var originalSubmission models.Submission
	problemObjID, _ := primitive.ObjectIDFromHex(submissionMsg.ProblemID)
	err = submissionsCollection.FindOne(ctx, bson.M{"_id": submissionObjID}).Decode(&originalSubmission)
	if err != nil {
		log.Printf("[submission=%s] Could not fetch original submission for Redis update: %v", submissionMsg.SubmissionID, err)
		// Continue without full data if necessary
	}

	updatedSubmission := models.Submission{
		ID:         submissionObjID,
		ProblemID:  problemObjID,
		Language:   submissionMsg.Language,
		Code:       submissionMsg.Code,
		Status:     submissionStatus,
		Output:     submissionOutput,
		TestResult: submissionTestResult,
		CreatedAt:  originalSubmission.CreatedAt,
		UserID:     originalSubmission.UserID,
		UpdatedAt:  time.Now(),
	}

	jsonSubmission, err := json.Marshal(updatedSubmission)
	if err == nil {
		err := redisClient.Set(ctx, fmt.Sprintf("submission:%s", submissionMsg.SubmissionID), jsonSubmission, 3600*time.Second).Err()
		if err != nil {
			log.Printf("[submission=%s] Error updating submission in Redis: %v", submissionMsg.SubmissionID, err)
		}
	}
}

// processSubmission is the main coordinator for handling a submission message.
func processSubmission(d amqp.Delivery, problemsCollection *mongo.Collection, submissionsCollection *mongo.Collection, redisClient *redis.Client, executor *executor.Executor) {
	ctx := context.Background()

	submissionMsg, err := validateAndDecodeSubmission(d)
	if err != nil {
		log.Printf("Validation failed: %v", err)
		d.Nack(false, false) // Permanent failure
		return
	}

	problem, err := fetchProblemData(ctx, problemsCollection, submissionMsg.ProblemID)
	if err != nil {
		log.Printf("[submission=%s] %v", submissionMsg.SubmissionID, err)
		d.Nack(false, true) // Transient failure (DB might be down)
		return
	}

	// Validate the problem data and parse/normalize test cases from the problem doc.
	if err := problem.ValidateBasic(); err != nil {
		log.Printf("[submission=%s] Invalid problem data: %v", submissionMsg.SubmissionID, err)
		d.Nack(false, false) // Permanent failure, bad data
		return
	}

	lang := languages.GetLanguage(submissionMsg.Language)
	if lang == nil {
		log.Printf("[submission=%s] Unsupported language: %s", submissionMsg.SubmissionID, submissionMsg.Language)
		d.Nack(false, false)
		return
	}

	tempDir, err := os.MkdirTemp("", "submission-")
	if err != nil {
		log.Printf("[submission=%s] Failed to create temp dir: %v", submissionMsg.SubmissionID, err)
		d.Nack(false, true) // Could be a transient host issue
		return
	}
	defer os.RemoveAll(tempDir)

	filesToCopy, compileCmd, runCmd, err := prepareSubmissionFiles(submissionMsg, problem, lang, tempDir)
	if err != nil {
		log.Printf("[submission=%s] Failed to prepare submission files: %v", submissionMsg.SubmissionID, err)
		d.Nack(false, false)
		return
	}

	execCtx, cancel := context.WithTimeout(ctx, 2*defaultSandboxTimeout)
	defer cancel()
	stdout, stderr, execErr := executor.RunSubmission(
		execCtx,
		lang.Image,
		filesToCopy,
		tempDir,
		compileCmd,
		runCmd,
		defaultSandboxTimeout,
	)
	log.Printf("Execution finished for submission %s. Stdout: %s, Stderr: %s, Error: %v", submissionMsg.SubmissionID, stdout, stderr, execErr)

	processAndStoreResults(ctx, stdout, stderr, execErr, submissionMsg, submissionsCollection, redisClient)

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

	// Normalize Redis address
	redisAddr := redisURI
	if strings.HasPrefix(redisURI, "redis://") {
		if u, err := url.Parse(redisURI); err == nil {
			redisAddr = u.Host
		} else {
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

	msgs, err := ch.Consume(
		submissionQueueName, // queue
		"",                  // consumer
		false,               // auto-ack
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
			processSubmission(d, problemsCollection, submissionsCollection, redisClient, executor)
		}
	}()

	<-forever
}