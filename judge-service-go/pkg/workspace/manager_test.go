package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewSubmissionWorkspaceCreatesScopedDirectory(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "judge-123")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatalf("failed to create container workspace: %v", err)
	}

	ws, err := NewSubmissionWorkspace(base, "sub/123")
	if err != nil {
		t.Fatalf("NewSubmissionWorkspace failed: %v", err)
	}
	t.Cleanup(func() {
		_ = CleanupSubmissionWorkspace(ws.HostPath)
	})

	if filepath.Dir(ws.HostPath) != base {
		t.Fatalf("expected workspace under %s, got %s", base, ws.HostPath)
	}
	if !strings.HasPrefix(filepath.Base(ws.HostPath), "sub-sub_123-") {
		t.Fatalf("unexpected workspace basename %q", filepath.Base(ws.HostPath))
	}
	if ws.ContainerPath != "/app/"+filepath.Base(ws.HostPath) {
		t.Fatalf("unexpected container path %q", ws.ContainerPath)
	}
}

func TestCleanupSubmissionWorkspaceRemovesDirectory(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, "judge-123")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatalf("failed to create container workspace: %v", err)
	}

	ws, err := NewSubmissionWorkspace(base, "cleanup")
	if err != nil {
		t.Fatalf("NewSubmissionWorkspace failed: %v", err)
	}

	if err := CleanupSubmissionWorkspace(ws.HostPath); err != nil {
		t.Fatalf("CleanupSubmissionWorkspace failed: %v", err)
	}

	if _, err := os.Stat(ws.HostPath); !os.IsNotExist(err) {
		t.Fatalf("expected workspace to be removed, stat err=%v", err)
	}
}

func TestCleanupSubmissionWorkspaceRejectsContainerRoot(t *testing.T) {
	base := t.TempDir()
	containerDir := filepath.Join(base, "judge-123")
	if err := os.MkdirAll(containerDir, 0755); err != nil {
		t.Fatalf("failed to create container dir: %v", err)
	}

	if err := CleanupSubmissionWorkspace(containerDir); err == nil {
		t.Fatal("expected cleanup guard to reject non-submission dir")
	}
}

func TestSweepSubmissionWorkspacesRemovesOnlyStaleSubmissionDirs(t *testing.T) {
	root := t.TempDir()
	containerDir := filepath.Join(root, "judge-123")
	if err := os.MkdirAll(containerDir, 0755); err != nil {
		t.Fatalf("failed to create container dir: %v", err)
	}

	staleDir := filepath.Join(containerDir, "sub-stale")
	freshDir := filepath.Join(containerDir, "sub-fresh")
	if err := os.MkdirAll(staleDir, 0755); err != nil {
		t.Fatalf("failed to create stale dir: %v", err)
	}
	if err := os.MkdirAll(freshDir, 0755); err != nil {
		t.Fatalf("failed to create fresh dir: %v", err)
	}

	oldTime := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(staleDir, oldTime, oldTime); err != nil {
		t.Fatalf("failed to age stale dir: %v", err)
	}

	removed, err := SweepSubmissionWorkspaces(root, time.Hour, time.Now())
	if err != nil {
		t.Fatalf("SweepSubmissionWorkspaces failed: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected 1 removed workspace, got %d", removed)
	}
	if _, err := os.Stat(staleDir); !os.IsNotExist(err) {
		t.Fatalf("expected stale dir removed, stat err=%v", err)
	}
	if _, err := os.Stat(freshDir); err != nil {
		t.Fatalf("expected fresh dir retained, stat err=%v", err)
	}
}
