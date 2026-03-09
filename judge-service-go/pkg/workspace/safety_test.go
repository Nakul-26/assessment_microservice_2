package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafeJoinRejectsEscape(t *testing.T) {
	base := t.TempDir()

	if _, err := SafeJoin(base, "../../etc/passwd"); err == nil {
		t.Fatal("expected path escape error")
	}
}

func TestWriteFileRejectsSymlink(t *testing.T) {
	base := t.TempDir()
	linkPath := filepath.Join(base, "wrapper.py")

	if err := os.Symlink("/etc/passwd", linkPath); err != nil {
		t.Fatalf("failed to create symlink: %v", err)
	}

	if err := WriteFile(base, "wrapper.py", []byte("print('nope')"), 0644); err == nil {
		t.Fatal("expected symlink write to be rejected")
	}
}

func TestValidateNoExternalSymlinksRejectsAbsoluteTarget(t *testing.T) {
	base := t.TempDir()
	linkPath := filepath.Join(base, "escape")

	if err := os.Symlink("/etc/passwd", linkPath); err != nil {
		t.Fatalf("failed to create symlink: %v", err)
	}

	if err := ValidateNoExternalSymlinks(base); err == nil {
		t.Fatal("expected external symlink validation error")
	}
}
