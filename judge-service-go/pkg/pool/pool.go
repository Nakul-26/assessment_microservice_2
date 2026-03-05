package pool

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"

	docker "github.com/fsouza/go-dockerclient"
)

// PooledContainer represents a container in the pool.
type PooledContainer struct {
	ID       string
	Language string
	Busy     bool
	WorkDir  string
}

// ContainerPool manages a pool of pre-warmed Docker containers.
type ContainerPool struct {
	cli        *docker.Client
	mu         sync.Mutex
	available  map[string][]*PooledContainer // language -> idle containers
	inUse      map[string]*PooledContainer   // containerID -> container
	maxPerLang int
}

// NewPool creates a new container pool.
func NewPool(cli *docker.Client, maxPerLang int) *ContainerPool {
	return &ContainerPool{
		cli:        cli,
		available:  make(map[string][]*PooledContainer),
		inUse:      make(map[string]*PooledContainer),
		maxPerLang: maxPerLang,
	}
}

// Acquire gets a container from the pool for the given language.
func (p *ContainerPool) Acquire(lang string) *PooledContainer {
	p.mu.Lock()
	defer p.mu.Unlock()

	if len(p.available[lang]) == 0 {
		return nil // Or create a new one if pool is not at max capacity
	}

	container := p.available[lang][0]
	p.available[lang] = p.available[lang][1:]
	container.Busy = true
	p.inUse[container.ID] = container
	return container
}

// Release returns a container to the pool.
func (p *ContainerPool) Release(container *PooledContainer) {
	p.mu.Lock()
	defer p.mu.Unlock()

	container.Busy = false
	delete(p.inUse, container.ID)
	p.available[container.Language] = append(p.available[container.Language], container)
}

// WarmUp creates an initial set of containers for a given language.
func (p *ContainerPool) WarmUp(ctx context.Context, lang string, image string, count int) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.pullImage(ctx, image); err != nil {
		return fmt.Errorf("failed to pull image %s: %w", image, err)
	}

	for i := 0; i < count; i++ {
		id, workDir, err := p.createContainer(ctx, image, lang)
		if err != nil {
			return err
		}
		p.available[lang] = append(p.available[lang], &PooledContainer{
			ID:       id,
			Language: lang,
			WorkDir:  workDir,
		})
	}
	return nil
}

// createContainer creates a new Docker container with a tmpfs volume mount.
func (p *ContainerPool) createContainer(ctx context.Context, image string, lang string) (string, string, error) {
	// Decide user. Prefer numeric UID if set, else do not force "judge" name to avoid missing passwd entry.
	user := os.Getenv("JUDGE_USER") // e.g., "judge"
	uid := os.Getenv("JUDGE_UID")   // e.g., "1000"
	var containerUser string
	if uid != "" {
		containerUser = uid
	} else if user != "" {
		containerUser = user
	} else {
		containerUser = "" // let image default to its default user
	}

	pidsLimit := int64(1024)

	// Create a temporary directory on the host for this container
	hostWorkDir, err := os.MkdirTemp("/tmp", "judge-")
	if err != nil {
		return "", "", fmt.Errorf("failed to create temp dir for container: %w", err)
	}
	// Container images typically run as a non-root "judge" user. The temp dir
	// created by MkdirTemp is 0700, which blocks bind-mounted file access.
	if err := os.Chmod(hostWorkDir, 0777); err != nil {
		return "", "", fmt.Errorf("failed to chmod container workdir %s: %w", hostWorkDir, err)
	}

	hostCfg := &docker.HostConfig{
		NetworkMode:    "none",
		ReadonlyRootfs: false, // Set to false to allow writing files
		Memory:         256 * 1024 * 1024,
		CPUQuota:       50000,
		PidsLimit:      &pidsLimit,
		Binds:          []string{fmt.Sprintf("%s:/app", hostWorkDir)},
	}

	containerOptions := docker.CreateContainerOptions{
		Context: ctx,
		Config: &docker.Config{
			Image:      image,
			Cmd:        []string{"tail", "-f", "/dev/null"},
			WorkingDir: "/app",
			Tty:        false,
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

	log.Printf("Started container %s for language %s with workdir %s", container.ID, lang, hostWorkDir)

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

	log.Printf("Pulling image: %s:%s", repo, tag)
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
