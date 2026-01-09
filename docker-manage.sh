#!/bin/bash
# PulseRelay Docker Management Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Function to build the Docker image
build_image() {
    print_status "Building PulseRelay Docker image..."
    docker build -t pulserelay:latest .
    print_success "Docker image built successfully!"
}

# Function to run development container
run_dev() {
    print_status "Starting PulseRelay in development mode..."
    docker-compose up --build
}

# Function to run production container
run_prod() {
    print_status "Starting PulseRelay in production mode..."
    
    # Check if config files exist
    if [ ! -f config.json ]; then
        print_warning "config.json not found. Creating from template..."
        cp config.json.template config.json
        print_warning "Please edit config.json with your configuration!"
    fi
    
    if [ ! -f secret.json ]; then
        print_warning "secret.json not found. Creating from template..."
        cp secret.json.template secret.json
        print_warning "Please edit secret.json with your secrets (Twitch OAuth, etc.)!"
    fi
    
    docker-compose -f docker-compose.prod.yml up -d
    print_success "PulseRelay started in production mode!"
    print_status "Access the application at: http://localhost:3000"
    print_status "RTMP endpoint: rtmp://localhost:1935/live/YOUR_STREAM_KEY"
}

# Function to stop containers
stop_containers() {
    print_status "Stopping PulseRelay containers..."
    docker-compose down
    docker-compose -f docker-compose.prod.yml down
    print_success "Containers stopped successfully!"
}

# Function to show logs
show_logs() {
    print_status "Showing PulseRelay logs..."
    docker-compose logs -f pulserelay
}

# Function to clean up Docker resources
cleanup() {
    print_status "Cleaning up Docker resources..."
    docker-compose down -v
    docker-compose -f docker-compose.prod.yml down -v
    docker system prune -f
    print_success "Cleanup completed!"
}

# Function to show container status
status() {
    print_status "PulseRelay container status:"
    docker-compose ps
    echo ""
    docker-compose -f docker-compose.prod.yml ps
}

# Function to show help
show_help() {
    echo "PulseRelay Docker Management Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  build     Build the Docker image"
    echo "  dev       Run in development mode"
    echo "  prod      Run in production mode"
    echo "  stop      Stop all containers"
    echo "  logs      Show application logs"
    echo "  status    Show container status"
    echo "  cleanup   Clean up Docker resources"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 build     # Build the Docker image"
    echo "  $0 dev       # Start development environment"
    echo "  $0 prod      # Start production environment"
    echo "  $0 logs      # Follow application logs"
}

# Main script logic
case "${1:-help}" in
    build)
        check_docker
        build_image
        ;;
    dev)
        check_docker
        run_dev
        ;;
    prod)
        check_docker
        run_prod
        ;;
    stop)
        check_docker
        stop_containers
        ;;
    logs)
        check_docker
        show_logs
        ;;
    status)
        check_docker
        status
        ;;
    cleanup)
        check_docker
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
