#!/bin/bash
set -euo pipefail

# Parse inputs
SCAN_PATH="${1:-.}"
SEVERITY_THRESHOLD="${2:-HIGH}"
OUTPUT_FORMAT="${3:-table}"

# Validate severity
VALID_SEVERITIES="UNKNOWN LOW MEDIUM HIGH CRITICAL"
if ! echo "$VALID_SEVERITIES" | grep -qw "$SEVERITY_THRESHOLD"; then
    echo "::error::Invalid severity threshold: $SEVERITY_THRESHOLD. Must be one of: $VALID_SEVERITIES"
    exit 1
fi

# Validate output format
VALID_FORMATS="table json sarif"
if ! echo "$VALID_FORMATS" | grep -qw "$OUTPUT_FORMAT"; then
    echo "::error::Invalid output format: $OUTPUT_FORMAT. Must be one of: $VALID_FORMATS"
    exit 1
fi

# Build severity filter based on threshold
case "$SEVERITY_THRESHOLD" in
    UNKNOWN)
        SEVERITY_FILTER="UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL"
        ;;
    LOW)
        SEVERITY_FILTER="LOW,MEDIUM,HIGH,CRITICAL"
        ;;
    MEDIUM)
        SEVERITY_FILTER="MEDIUM,HIGH,CRITICAL"
        ;;
    HIGH)
        SEVERITY_FILTER="HIGH,CRITICAL"
        ;;
    CRITICAL)
        SEVERITY_FILTER="CRITICAL"
        ;;
esac

# Set up report output path
REPORT_DIR="${GITHUB_WORKSPACE:-.}/.security-reports"
mkdir -p "$REPORT_DIR"

case "$OUTPUT_FORMAT" in
    json)
        REPORT_FILE="$REPORT_DIR/trivy-report.json"
        ;;
    sarif)
        REPORT_FILE="$REPORT_DIR/trivy-report.sarif"
        ;;
    *)
        REPORT_FILE="$REPORT_DIR/trivy-report.txt"
        ;;
esac

echo "::group::Security Scan Configuration"
echo "Scan path:          $SCAN_PATH"
echo "Severity threshold: $SEVERITY_THRESHOLD"
echo "Severity filter:    $SEVERITY_FILTER"
echo "Output format:      $OUTPUT_FORMAT"
echo "Report file:        $REPORT_FILE"
echo "::endgroup::"

# Update Trivy vulnerability database
echo "::group::Updating vulnerability database"
trivy --quiet image --download-db-only 2>/dev/null || true
echo "::endgroup::"

# Run Trivy filesystem scan
echo "::group::Running security scan"

TRIVY_EXIT_CODE=0

# Run scan and capture output
trivy filesystem \
    --severity "$SEVERITY_FILTER" \
    --format "$OUTPUT_FORMAT" \
    --output "$REPORT_FILE" \
    --exit-code 0 \
    --no-progress \
    "$SCAN_PATH" || TRIVY_EXIT_CODE=$?

if [ "$TRIVY_EXIT_CODE" -ne 0 ]; then
    echo "::warning::Trivy exited with code $TRIVY_EXIT_CODE"
fi

echo "::endgroup::"

# Count vulnerabilities
VULN_COUNT=0

if [ "$OUTPUT_FORMAT" = "json" ] && [ -f "$REPORT_FILE" ]; then
    # Parse JSON output to count vulnerabilities
    VULN_COUNT=$(jq '[.Results[]? | .Vulnerabilities[]?] | length' "$REPORT_FILE" 2>/dev/null || echo "0")
elif [ "$OUTPUT_FORMAT" = "table" ] && [ -f "$REPORT_FILE" ]; then
    # Count lines that look like vulnerability entries in table output
    VULN_COUNT=$(grep -cE "^[│|].*CVE-" "$REPORT_FILE" 2>/dev/null || echo "0")
elif [ "$OUTPUT_FORMAT" = "sarif" ] && [ -f "$REPORT_FILE" ]; then
    VULN_COUNT=$(jq '[.runs[]?.results[]?] | length' "$REPORT_FILE" 2>/dev/null || echo "0")
fi

# Print report to console if table format
if [ "$OUTPUT_FORMAT" = "table" ] && [ -f "$REPORT_FILE" ]; then
    echo ""
    echo "=== Scan Results ==="
    cat "$REPORT_FILE"
fi

echo ""
echo "=== Summary ==="
echo "Vulnerabilities found: $VULN_COUNT"
echo "Report saved to: $REPORT_FILE"

# Set outputs
echo "vulnerabilities-count=$VULN_COUNT" >> "$GITHUB_OUTPUT"
echo "report-path=$REPORT_FILE" >> "$GITHUB_OUTPUT"

# Annotate if vulnerabilities found
if [ "$VULN_COUNT" -gt 0 ]; then
    echo "::warning::Found $VULN_COUNT vulnerability/vulnerabilities at or above $SEVERITY_THRESHOLD severity."
fi

exit 0
