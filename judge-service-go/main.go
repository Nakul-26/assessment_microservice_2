package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/redis/go-redis/v9"

	"judge-service-go/pkg/central/adapters"
	"judge-service-go/pkg/executor"
	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
	"judge-service-go/pkg/pool"
	"judge-service-go/pkg/workspace"
	"judge-service-go/pkg/wrapper"
)

const (
	defaultRabbitMQURL      = "amqp://user:password@rabbitmq:5672"
	defaultSubmissionQueue  = "submission_queue"
	defaultMongoURI         = "mongodb://mongo:27017/assessment_db"
	defaultRedisURI         = "redis://redis:6379"
	defaultSandboxTimeout   = 5 * time.Second
	centralComparePythonEnv = "JUDGE_CENTRAL_COMPARE_PY"
	centralCompareJSEnv     = "JUDGE_CENTRAL_COMPARE_JS"
	centralCompareJavaEnv   = "JUDGE_CENTRAL_COMPARE_JAVA"
	maxTestOutputBytes      = 64 * 1024
	maxLogOutputBytes       = 4 * 1024
	maxTestsBytes           = 1 << 20 // 1MB
	defaultPoolSizePerLang  = 2
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

func isTruthyEnv(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

type singleTestExecOutput struct {
	Output    interface{} `json:"output"`
	Error     string      `json:"error,omitempty"`
	Traceback string      `json:"traceback,omitempty"`
}

func truncateString(s string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(s) <= maxBytes {
		return s, false
	}
	return s[:maxBytes], true
}

func parseSingleTestOutput(rawStdout string) (singleTestExecOutput, error) {
	var out singleTestExecOutput
	trimmed := strings.TrimSpace(rawStdout)
	if trimmed == "" {
		return out, fmt.Errorf("empty wrapper output")
	}
	if err := json.Unmarshal([]byte(trimmed), &out); err == nil {
		return out, nil
	}

	// If user prints extra lines, try parsing the last non-empty line as JSON.
	lines := strings.Split(trimmed, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if err := json.Unmarshal([]byte(line), &out); err == nil {
			return out, nil
		}
		break
	}
	return out, fmt.Errorf("wrapper output is not valid JSON")
}

func perTestTimeout(problem models.Problem) time.Duration {
	if problem.TimeLimitMs > 0 {
		return time.Duration(problem.TimeLimitMs) * time.Millisecond
	}
	return defaultSandboxTimeout
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
		if err := workspace.WriteFile(tempDir, submissionFileName, []byte(submissionCode), 0644); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to write submission file: %w", err)
		}
		if err := workspace.WriteFile(tempDir, wrapperFileName, []byte(wrapperCode), 0644); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to write wrapper file: %w", err)
		}
		filesToCopy = []string{submissionFileName, wrapperFileName}
	} else {
		finalCode := strings.Replace(wrapperCode, "// USER_CODE_MARKER", submissionMsg.Code, 1)
		finalCode = strings.Replace(finalCode, "# USER_CODE_MARKER", submissionMsg.Code, 1)

		switch lang.ID {
		case "java":
			solutionFileName := "Solution.java"
			if err := workspace.WriteFile(tempDir, solutionFileName, []byte(submissionMsg.Code), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write solution file: %w", err)
			}
			submissionFileName := "GeneratedTester.java"
			if err := workspace.WriteFile(tempDir, submissionFileName, []byte(wrapperCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{solutionFileName, submissionFileName}
		case "python":
			submissionFileName := "wrapper.py"
			solutionFileName := "solution.py"
			if err := workspace.WriteFile(tempDir, solutionFileName, []byte(submissionMsg.Code), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write solution file: %w", err)
			}
			if err := workspace.WriteFile(tempDir, submissionFileName, []byte(finalCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{submissionFileName, solutionFileName}
		default: // C, CSharp, etc.
			submissionFileName := "main" + lang.FileExt
			if err := workspace.WriteFile(tempDir, submissionFileName, []byte(finalCode), 0644); err != nil {
				return nil, nil, nil, fmt.Errorf("failed to write combined submission file: %w", err)
			}
			filesToCopy = []string{submissionFileName}
		}
	}

	return filesToCopy, compileCmd, runCmd, nil
}

// processAndStoreResults processes the executor output and updates the database and cache.
func fallbackResultForExecutionFailure(executionPath string, execErr error, stdout string) *models.SubmissionResult {
	result := models.NewSubmissionResult()
	result.ExecutionPath = executionPath
	result.Status = models.SubmissionStatusRuntimeError

	if stdout != "" {
		result.InternalError = models.InternalErrorJudge
		return result
	}

	if execErr != nil {
		errText := strings.ToLower(execErr.Error())
		if strings.Contains(errText, "compilation failed") || strings.Contains(errText, "compilation command failed") {
			return result
		}
		if strings.Contains(errText, "timed out") || strings.Contains(errText, "deadline exceeded") {
			return result
		}
	}

	result.InternalError = models.InternalErrorWrapper
	return result
}

func processAndStoreResults(ctx context.Context, executionPath string, stdout, stderr string, execErr error, submissionMsg models.SubmissionMessage, submissionsCollection *mongo.Collection, redisClient *redis.Client) {
	var result models.SubmissionResult
	submissionStatus := models.StatusError
	submissionOutput := stderr
	var submissionTestResult *models.SubmissionResult

	if stdout != "" {
		if err := json.Unmarshal([]byte(stdout), &result); err == nil {
			submissionTestResult = &result
			submissionTestResult.ExecutionPath = executionPath
			result.NormalizeCounts()
			switch result.Status {
			case models.SubmissionStatusAccepted:
				submissionStatus = models.StatusSuccess
			case models.SubmissionStatusWrongAnswer:
				submissionStatus = models.StatusFail
			case models.SubmissionStatusRuntimeError, models.SubmissionStatusTimeLimitExceeded:
				submissionStatus = models.StatusError
			default:
				submissionStatus = models.StatusError
			}
			submissionOutput = stdout
		} else {
			log.Printf("[submission=%s] Error unmarshalling stdout to result: %v, Stdout: %s", submissionMsg.SubmissionID, err, stdout)
			submissionTestResult = fallbackResultForExecutionFailure(executionPath, execErr, stdout)
			submissionOutput = fmt.Sprintf("Invalid judge output: %v\nStdout: %s", err, stdout)
			if execErr != nil {
				submissionOutput += fmt.Sprintf("\nExecution Error: %v\nStderr: %s", execErr, stderr)
			}
		}
	} else if execErr != nil {
		submissionTestResult = fallbackResultForExecutionFailure(executionPath, execErr, stdout)
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
func processSubmission(d amqp.Delivery, problemsCollection *mongo.Collection, submissionsCollection *mongo.Collection, redisClient *redis.Client, executor *executor.Executor, containerPool *pool.ContainerPool) {
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

	// Acquire a container from the pool
	pooledContainer := containerPool.Acquire(lang.ID)
	if pooledContainer == nil {
		log.Printf("[submission=%s] No available containers for language %s, retrying...", submissionMsg.SubmissionID, lang.ID)
		d.Nack(false, true)
		return
	}
	defer containerPool.Release(pooledContainer)

	if adapter, ok := adapters.GetAdapter(lang.ID); ok && isCentralCompareEnabled(lang.ID) {
		execCtx, cancel := context.WithTimeout(ctx, time.Duration(len(problem.TestCases)+1)*defaultSandboxTimeout)
		defer cancel()

		result, err := runSubmissionCentral(execCtx, executor, pooledContainer, submissionMsg, problem, adapter)
		if err != nil {
			log.Printf("[submission=%s] Central %s execution setup failed: %v", submissionMsg.SubmissionID, adapter.Name(), err)
			d.Nack(false, false)
			return
		}

		resultBytes, err := result.ToJSON()
		if err != nil {
			log.Printf("[submission=%s] Failed to marshal central result: %v", submissionMsg.SubmissionID, err)
			d.Nack(false, false)
			return
		}
		processAndStoreResults(ctx, models.ExecutionPathCentral, string(resultBytes), "", nil, submissionMsg, submissionsCollection, redisClient)

		d.Ack(false)
		return
	}

	submissionWorkspace, err := workspace.NewSubmissionWorkspace(pooledContainer.WorkDir, submissionMsg.SubmissionID)
	if err != nil {
		log.Printf("[submission=%s] Failed to create submission workspace: %v", submissionMsg.SubmissionID, err)
		d.Nack(false, true)
		return
	}
	defer func() {
		if cleanupErr := workspace.CleanupSubmissionWorkspace(submissionWorkspace.HostPath); cleanupErr != nil {
			log.Printf("[submission=%s] Failed to cleanup submission workspace %s: %v", submissionMsg.SubmissionID, submissionWorkspace.HostPath, cleanupErr)
		}
	}()

	filesToCopy, compileCmd, runCmd, err := prepareSubmissionFiles(submissionMsg, problem, lang, submissionWorkspace.HostPath)
	if err != nil {
		log.Printf("[submission=%s] Failed to prepare submission files: %v", submissionMsg.SubmissionID, err)
		d.Nack(false, false)
		return
	}

	execCtx, cancel := context.WithTimeout(ctx, 2*defaultSandboxTimeout)
	defer cancel()

	// RunSubmission needs to be refactored to use the pooled container
	stdout, stderr, execErr := executor.RunInContainer(
		execCtx,
		pooledContainer.ID,
		filesToCopy,
		submissionWorkspace.HostPath,
		submissionWorkspace.ContainerPath,
		compileCmd,
		runCmd,
		defaultSandboxTimeout,
	)
	log.Printf("Execution finished for submission %s. Stdout: %s, Stderr: %s, Error: %v", submissionMsg.SubmissionID, stdout, stderr, execErr)

	processAndStoreResults(ctx, models.ExecutionPathLegacy, stdout, stderr, execErr, submissionMsg, submissionsCollection, redisClient)

	d.Ack(false)
}

func isCentralCompareEnabled(language string) bool {
	switch language {
	case "python":
		if raw, ok := os.LookupEnv(centralComparePythonEnv); ok {
			return isTruthyEnv(raw)
		}
		return true
	case "javascript":
		if raw, ok := os.LookupEnv(centralCompareJSEnv); ok {
			return isTruthyEnv(raw)
		}
		return true
	case "java":
		return isTruthyEnv(os.Getenv(centralCompareJavaEnv))
	default:
		return false
	}
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

	// Initialize Container Pool
	containerPool := pool.NewPool(executor.Client(), defaultPoolSizePerLang)
	log.Println("Warming up container pool...")
	workspace.StartSweeper(
		context.Background(),
		workspace.RootDir,
		5*time.Minute,
		time.Hour,
	)
	var wg sync.WaitGroup
	for _, lang := range languages.GetSupportedLanguages() {
		wg.Add(1)
		go func(l *languages.Language) {
			defer wg.Done()
			log.Printf("Warming up pool for %s...", l.ID)
			err := containerPool.WarmUp(context.Background(), l.ID, l.Image, defaultPoolSizePerLang)
			if err != nil {
				log.Printf("Failed to warm up pool for %s: %v", l.ID, err)
			}
		}(lang)
	}
	wg.Wait()
	log.Println("Container pool warmed up.")

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

	for i := 0; i < runtime.NumCPU(); i++ { // Number of concurrent workers
		go func() {
			for d := range msgs {
				processSubmission(d, problemsCollection, submissionsCollection, redisClient, executor, containerPool)
			}
		}()
	}

	<-forever
}
