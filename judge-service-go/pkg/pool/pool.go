package pool

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	docker "github.com/fsouza/go-dockerclient"

	"judge-service-go/pkg/metrics"
	"judge-service-go/pkg/workspace"
)

// PooledContainer represents a container in the pool.
type PooledContainer struct {
	ID             string
	Language       string
	Busy           bool
	WorkDir        string
	ExecutionCount int32
}

// ContainerPool manages a pool of pre-warmed Docker containers.
type ContainerPool struct {
	cli        *docker.Client
	mu         sync.Mutex
	availChans map[string]chan *PooledContainer // language -> idle containers
	inUse      map[string]*PooledContainer      // containerID -> container
	maxPerLang int
	images     map[string]string // language -> image name
}

// NewPool creates a new container pool.
func NewPool(cli *docker.Client, maxPerLang int) *ContainerPool {
	return &ContainerPool{
		cli:        cli,
		availChans: make(map[string]chan *PooledContainer),
		inUse:      make(map[string]*PooledContainer),
		maxPerLang: maxPerLang,
		images:     make(map[string]string),
	}
}

// Acquire gets a container from the pool for the given language.
// It blocks until a container is available or the context is cancelled.
func (p *ContainerPool) Acquire(ctx context.Context, lang string) *PooledContainer {
	p.mu.Lock()
	ch, ok := p.availChans[lang]
	p.mu.Unlock()

	if !ok {
		return nil
	}

	select {
	case container := <-ch:
		p.mu.Lock()
		container.Busy = true
		p.inUse[container.ID] = container
		p.mu.Unlock()
		return container
	case <-ctx.Done():
		return nil
	}
}

// Release returns a container to the pool.
func (p *ContainerPool) Release(container *PooledContainer) {
	if container == nil {
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.inUse[container.ID]; !ok {
		return
	}
	container.Busy = false
	delete(p.inUse, container.ID)

	ch, ok := p.availChans[container.Language]
	if !ok {
		// Should not happen if pool is managed correctly
		slog.Error("Releasing container for unknown language", "language", container.Language)
		p.removeContainer(container)
		return
	}

	select {
	case ch <- container:
		// success
	default:
		// Channel full? Should not happen if maxPerLang is respected
		slog.Warn("Container pool channel full during release", "language", container.Language)
		p.removeContainer(container)
	}
}

// Discard removes a suspect container from the pool and creates a replacement.
func (p *ContainerPool) Discard(ctx context.Context, container *PooledContainer, reason string) {
	if container == nil {
		return
	}

	p.mu.Lock()
	_, wasInUse := p.inUse[container.ID]
	if wasInUse {
		delete(p.inUse, container.ID)
	}
	image := p.images[container.Language]
	ch := p.availChans[container.Language]
	p.mu.Unlock()

	if !wasInUse {
		slog.Warn("Ignoring discard for container that is not in use", "containerId", container.ID, "language", container.Language, "reason", reason)
		return
	}

	slog.Warn("Discarding pooled container", "containerId", container.ID, "language", container.Language, "reason", reason)
	p.removeContainer(container)

	if image == "" {
		slog.Error("Cannot replace discarded container; image is unknown", "language", container.Language)
		return
	}

	replacement, err := p.newPooledContainer(ctx, image, container.Language)
	if err != nil {
		slog.Error("Failed to replace discarded container", "language", container.Language, "error", err)
		return
	}
	metrics.AddContainerReplacement(1)

	if ch != nil {
		select {
		case ch <- replacement:
			slog.Info("Replaced discarded container", "oldId", container.ID, "newId", replacement.ID, "language", container.Language)
		default:
			slog.Warn("Container pool channel full during discard/replacement", "language", container.Language)
			p.removeContainer(replacement)
		}
	}
}

// WarmUp creates an initial set of containers for a given language.
func (p *ContainerPool) WarmUp(ctx context.Context, lang string, image string, count int) error {
	p.mu.Lock()
	p.images[lang] = image
	if p.availChans[lang] == nil {
		p.availChans[lang] = make(chan *PooledContainer, count)
	}
	ch := p.availChans[lang]
	p.mu.Unlock()

	if err := p.pullImage(ctx, image); err != nil {
		return fmt.Errorf("failed to pull image %s: %w", image, err)
	}

	for i := 0; i < count; i++ {
		id, workDir, err := p.createContainer(ctx, image, lang)
		if err != nil {
			return err
		}
		c := &PooledContainer{
			ID:             id,
			Language:       lang,
			WorkDir:        workDir,
			ExecutionCount: 0,
		}
		select {
		case ch <- c:
			// success
		default:
			slog.Warn("WarmUp: channel full, discarding extra container", "language", lang)
			p.removeContainer(c)
		}
	}
	return nil
}

// Shutdown stops and removes all containers in the pool.
func (p *ContainerPool) Shutdown(ctx context.Context) {
	p.mu.Lock()
	slog.Info("Shutting down container pool", "total_languages", len(p.availChans), "total_in_use", len(p.inUse))

	var wg sync.WaitGroup

	remove := func(c *PooledContainer) {
		defer wg.Done()
		slog.Debug("Removing container", "containerId", c.ID, "language", c.Language)
		err := p.cli.RemoveContainer(docker.RemoveContainerOptions{
			ID:    c.ID,
			Force: true,
		})
		if err != nil {
			slog.Error("Failed to remove container during shutdown", "containerId", c.ID, "error", err)
		}
		// Also cleanup the workdir
		if err := workspace.CleanupContainerWorkspace(c.WorkDir); err != nil {
			slog.Error("Failed to cleanup workdir during shutdown", "workdir", c.WorkDir, "error", err)
		}
	}

	// Drain all available channels
	for lang, ch := range p.availChans {
		close(ch)
		for c := range ch {
			wg.Add(1)
			go remove(c)
		}
		delete(p.availChans, lang)
	}

	for id, c := range p.inUse {
		wg.Add(1)
		go remove(c)
		delete(p.inUse, id)
	}
	p.mu.Unlock()

	wg.Wait()
}

// PoolStats represents the current state of the container pool.
type PoolStats struct {
	Available map[string]int `json:"available"`
	InUse     map[string]int `json:"in_use"`
}

// GetStats returns the current statistics of the container pool.
func (p *ContainerPool) GetStats() PoolStats {
	p.mu.Lock()
	defer p.mu.Unlock()

	stats := PoolStats{
		Available: make(map[string]int),
		InUse:     make(map[string]int),
	}

	for lang, ch := range p.availChans {
		stats.Available[lang] = len(ch)
	}

	for _, c := range p.inUse {
		stats.InUse[c.Language]++
	}

	return stats
}

// StartMonitor starts a background goroutine to monitor container health.
func (p *ContainerPool) StartMonitor(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				p.checkHealth(ctx)
			}
		}
	}()
}

// StartReconciler periodically ensures the pool size per language matches maxPerLang.
func (p *ContainerPool) StartReconciler(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
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
				p.mu.Lock()
				langs := make([]string, 0, len(p.availChans))
				for lang := range p.availChans {
					langs = append(langs, lang)
				}
				p.mu.Unlock()

				metrics.SetReconcileLastRun(time.Now())

				for _, lang := range langs {
					p.mu.Lock()
					ch := p.availChans[lang]
					image := p.images[lang]
					inUseCount := 0
					for _, c := range p.inUse {
						if c.Language == lang {
							inUseCount++
						}
					}
					availCount := 0
					if ch != nil {
						availCount = len(ch)
					}
					current := inUseCount + availCount
					target := p.maxPerLang
					p.mu.Unlock()

					if current < target {
						// create missing containers
						missing := target - current
						for i := 0; i < missing; i++ {
							repl, err := p.newPooledContainer(ctx, image, lang)
							if err != nil {
								slog.Error("reconciler: failed to create replacement", "language", lang, "error", err)
								break
							}
							metrics.AddReconcileRepairs(1)
							p.mu.Lock()
							if ch2, ok := p.availChans[lang]; ok {
								select {
								case ch2 <- repl:
								default:
									p.removeContainer(repl)
								}
							} else {
								p.removeContainer(repl)
							}
							p.mu.Unlock()
						}
					} else if current > target {
						// remove excess available containers (prefer idle ones)
						excess := current - target
						if excess > 0 && ch != nil {
							for i := 0; i < excess; i++ {
								select {
								case c := <-ch:
									p.removeContainer(c)
								default:
									// no more idle containers to remove
								}
							}
						}
					}
				}
			}
		}
	}()
}

func (p *ContainerPool) checkHealth(ctx context.Context) {
	p.mu.Lock()
	langs := make([]string, 0, len(p.availChans))
	for lang := range p.availChans {
		langs = append(langs, lang)
	}
	p.mu.Unlock()

	for _, lang := range langs {
		p.mu.Lock()
		ch := p.availChans[lang]
		image := p.images[lang]
		p.mu.Unlock()

		if ch == nil {
			continue
		}

		// Non-blocking health check of available containers
		count := len(ch)
		for i := 0; i < count; i++ {
			var c *PooledContainer
			select {
			case c = <-ch:
			default:
				continue
			}

			if p.isContainerHealthy(c.ID) {
				select {
				case ch <- c:
				default:
					p.removeContainer(c)
				}
			} else {
				slog.Warn("Container found unhealthy, removing", "containerId", c.ID, "language", lang)
				p.removeContainer(c)

				if image != "" {
					replacement, err := p.newPooledContainer(ctx, image, lang)
					if err == nil {
						select {
						case ch <- replacement:
							slog.Info("Replaced unhealthy container", "oldId", c.ID, "newId", replacement.ID, "language", lang)
						default:
							p.removeContainer(replacement)
						}
					} else {
						slog.Error("Failed to recreate replacement container", "language", lang, "error", err)
					}
				}
			}
		}
	}
}

func (p *ContainerPool) isContainerHealthy(id string) bool {
	container, err := p.cli.InspectContainerWithOptions(docker.InspectContainerOptions{ID: id})
	if err != nil {
		return false
	}
	return container.State.Running && !container.State.Paused
}

func (p *ContainerPool) removeContainer(c *PooledContainer) {
	_ = p.cli.RemoveContainer(docker.RemoveContainerOptions{
		ID:    c.ID,
		Force: true,
	})
	_ = workspace.CleanupContainerWorkspace(c.WorkDir)
}

func (p *ContainerPool) newPooledContainer(ctx context.Context, image string, lang string) (*PooledContainer, error) {
	id, workDir, err := p.createContainer(ctx, image, lang)
	if err != nil {
		return nil, err
	}
	return &PooledContainer{
		ID:       id,
		Language: lang,
		WorkDir:  workDir,
	}, nil
}

// createContainer creates a new Docker container with a tmpfs volume mount.
func (p *ContainerPool) createContainer(ctx context.Context, image string, lang string) (string, string, error) {
	// For pooled containers, we run the main process as root.
	// This ensures that PID 1 (init) and PID 2 (tail) are not owned by the 'judge' user.
	// Subsequent user-code execution will be done as the 'judge' user via 'docker exec'.
	containerUser := "root"

	pidsLimit := int64(128)
	memoryBytes := int64(1024 * 1024 * 1024) // Increase to 1GB
	memorySwap := memoryBytes
	noNewPrivileges := "no-new-privileges:true"

	// Create a temporary directory on the host for this container
	if err := os.MkdirAll(workspace.RootDir, 0755); err != nil {
		return "", "", fmt.Errorf("failed to create workspace root %s: %w", workspace.RootDir, err)
	}
	hostWorkDir, err := os.MkdirTemp(workspace.RootDir, "judge-")
	if err != nil {
		return "", "", fmt.Errorf("failed to create temp dir for container: %w", err)
	}
	// hostWorkDir is used purely as a host-side staging area: submission source files
	// are written here, then read back and uploaded into the container via the Docker
	// exec/UploadToContainer API (see executor.copyFilesToContainer) — it is never
	// bind-mounted into the container. Container images typically run as a non-root
	// "judge" user, so keep this permissive for the judge-service process's own use.
	if err := os.Chmod(hostWorkDir, 0777); err != nil {
		return "", "", fmt.Errorf("failed to chmod container workdir %s: %w", hostWorkDir, err)
	}

	hostCfg := &docker.HostConfig{
		NetworkMode:    "none",
		ReadonlyRootfs: true,
		SecurityOpt:    []string{noNewPrivileges},
		CapDrop:        []string{"ALL"},
		CapAdd:         []string{"KILL"},
		Memory:         memoryBytes,
		MemorySwap:     memorySwap,
		CPUQuota:       100000, // Increase to 1.0 CPU
		PidsLimit:      &pidsLimit,
		Init:           true,
		Tmpfs: map[string]string{
			"/tmp": "rw,noexec,nosuid,nodev,size=512m",
			// /app is tmpfs (not a host bind mount) so a submission that writes a huge
			// file there fills bounded, memory-backed space instead of real host disk.
			// Unlike /tmp, this must stay executable — compiled binaries run from here.
			// "exec" must be listed explicitly: Docker defaults tmpfs mounts to noexec
			// when the option isn't named outright, even though nothing here asked for
			// noexec — confirmed via `mount`/`/proc/mounts` showing noexec on this
			// engine version despite this string never containing it. Without "exec",
			// every compiled language's own freshly-built binary 126s with "permission
			// denied" trying to exec itself from /app.
			"/app": "rw,exec,nosuid,nodev,size=512m",
		},
	}

	containerOptions := docker.CreateContainerOptions{
		Context: ctx,
		Config: &docker.Config{
			Image:      image,
			Cmd:        []string{"tail", "-f", "/dev/null"},
			WorkingDir: "/app",
			Tty:        false,
			Labels: map[string]string{
				"app":        "code-platform",
				"service":    "judge",
				"managed-by": "judge-service",
				"language":   lang,
				"pool":       "true",
			},
		},
		HostConfig: hostCfg,
	}

	// If containerUser configured, set it
	if containerUser != "" {
		containerOptions.Config.User = containerUser
	}

	container, err := p.cli.CreateContainer(containerOptions)
	if err != nil {
		return "", "", fmt.Errorf("failed to create container: %w", err)
	}

	if err := p.cli.StartContainer(container.ID, nil); err != nil {
		// If starting fails, try to remove the container
		_ = p.cli.RemoveContainer(docker.RemoveContainerOptions{ID: container.ID, Force: true})
		return "", "", fmt.Errorf("failed to start container: %w", err)
	}

	slog.Info("Started container", "containerId", container.ID, "language", lang, "workdir", filepath.Clean(hostWorkDir))

	return container.ID, hostWorkDir, nil
}

// pullImage pulls a Docker image if it's not available locally
func (p *ContainerPool) pullImage(ctx context.Context, image string) error {
	// If image exists locally, skip
	if _, err := p.cli.InspectImage(image); err == nil {
		return nil
	} else if err != docker.ErrNoSuchImage {
		return fmt.Errorf("failed to inspect image %s: %w", image, err)
	}

	// Parse image into repository and tag
	repo, tag := image, "latest"
	if strings.Contains(image, ":") {
		parts := strings.SplitN(image, ":", 2)
		repo, tag = parts[0], parts[1]
	}

	slog.Info("Pulling image", "repository", repo, "tag", tag)
	pullOptions := docker.PullImageOptions{
		Repository:   repo,
		Tag:          tag,
		Context:      ctx,
		OutputStream: io.Discard,
	}
	auth := docker.AuthConfiguration{}
	if err := p.cli.PullImage(pullOptions, auth); err != nil {
		return fmt.Errorf("failed to pull image %s: %w", image, err)
	}
	return nil
}
