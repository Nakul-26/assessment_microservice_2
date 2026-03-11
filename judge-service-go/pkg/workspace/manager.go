package workspace

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	containerWorkspaceRoot = "/app"
	RootDir                = "/tmp/judge-workspaces"
)

var workspaceNameSanitizer = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

type SubmissionWorkspace struct {
	HostPath      string
	ContainerPath string
}

func NewSubmissionWorkspace(containerWorkDir, submissionID string) (*SubmissionWorkspace, error) {
	if submissionID == "" {
		submissionID = "anonymous"
	}

	safeID := workspaceNameSanitizer.ReplaceAllString(submissionID, "_")
	if safeID == "" {
		safeID = "anonymous"
	}

	hostPath, err := os.MkdirTemp(containerWorkDir, "sub-"+safeID+"-")
	if err != nil {
		return nil, fmt.Errorf("create submission workspace: %w", err)
	}
	if err := os.Chmod(hostPath, 0777); err != nil {
		_ = os.RemoveAll(hostPath)
		return nil, fmt.Errorf("chmod submission workspace %s: %w", hostPath, err)
	}

	containerPath := filepath.ToSlash(filepath.Join(containerWorkspaceRoot, filepath.Base(hostPath)))
	return &SubmissionWorkspace{
		HostPath:      hostPath,
		ContainerPath: containerPath,
	}, nil
}

func CleanupSubmissionWorkspace(path string) error {
	if err := validateSubmissionWorkspacePath(path); err != nil {
		return err
	}
	return os.RemoveAll(path)
}

func StartSweeper(ctx context.Context, root string, interval time.Duration, maxAge time.Duration) {
	if interval <= 0 || maxAge <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				removed, err := SweepSubmissionWorkspaces(root, maxAge, time.Now())
				if err != nil {
					log.Printf("workspace sweeper failed: %v", err)
					continue
				}
				if removed > 0 {
					log.Printf("workspace sweeper removed %d stale submission workspaces", removed)
				}
			}
		}
	}()
}

func SweepSubmissionWorkspaces(root string, maxAge time.Duration, now time.Time) (int, error) {
	if root == "" {
		return 0, fmt.Errorf("workspace root is required")
	}
	if maxAge <= 0 {
		return 0, fmt.Errorf("maxAge must be positive")
	}

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return 0, fmt.Errorf("resolve workspace root: %w", err)
	}

	entries, err := os.ReadDir(rootAbs)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("read workspace root %s: %w", rootAbs, err)
	}

	removed := 0
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "judge-") {
			continue
		}

		containerDir, err := SafeJoin(rootAbs, entry.Name())
		if err != nil {
			return removed, err
		}

		subEntries, err := os.ReadDir(containerDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return removed, fmt.Errorf("read container workspace %s: %w", containerDir, err)
		}

		for _, subEntry := range subEntries {
			if !subEntry.IsDir() || !strings.HasPrefix(subEntry.Name(), "sub-") {
				continue
			}

			subPath, err := SafeJoin(containerDir, subEntry.Name())
			if err != nil {
				return removed, err
			}
			info, err := os.Stat(subPath)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return removed, fmt.Errorf("stat submission workspace %s: %w", subPath, err)
			}
			if now.Sub(info.ModTime()) < maxAge {
				continue
			}
			if err := CleanupSubmissionWorkspace(subPath); err != nil {
				return removed, err
			}
			removed++
		}
	}

	return removed, nil
}

func validateSubmissionWorkspacePath(path string) error {
	if path == "" {
		return fmt.Errorf("workspace path is required")
	}

	cleanPath := filepath.Clean(path)
	base := filepath.Base(cleanPath)
	if !strings.HasPrefix(base, "sub-") {
		return fmt.Errorf("refusing to delete non-submission workspace: %s", cleanPath)
	}

	parent := filepath.Base(filepath.Dir(cleanPath))
	if !strings.HasPrefix(parent, "judge-") {
		return fmt.Errorf("refusing to delete workspace outside judge container dir: %s", cleanPath)
	}

	return nil
}
