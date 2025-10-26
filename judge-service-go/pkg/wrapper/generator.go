package wrapper

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"judge-service-go/pkg/languages"
	"judge-service-go/pkg/models"
)

// GenerateWrapper reads the language-specific template (from pkg/wrappers),
// builds a tests JSON array by parsing each TestCase.InputRaw according to the
// Problem.ExpectedIoType, and fills template placeholders such as {{TESTS_JSON}}
// and {{FUNCTION_NAME}} (and {{CLASS_NAME}} for Java). The returned string is
// the wrapper content; the caller should insert the user's code at the
// USER_CODE_MARKER location.
func GenerateWrapper(p models.Problem, lang languages.Language) (string, error) {
	tplPath := filepath.Join("pkg", "wrappers", lang.WrapperTemplate)
	b, err := os.ReadFile(tplPath)
	if err != nil {
		return "", fmt.Errorf("failed to read template %s: %w", tplPath, err)
	}
	tpl := string(b)

	// Build tests array
	tests := make([]map[string]interface{}, 0, len(p.TestCases))
	for _, tc := range p.TestCases {
		// Input may already be parsed (interface{}) or a raw string; handle both
		var parsedInput interface{}
		switch v := tc.Input.(type) {
		case string:
			parsedInput, _ = parseInputRaw(v, p.ExpectedIoType)
		case map[string]interface{}:
			parsedInput = v
		default:
			// Try to marshal/unmarshal into interface{} so we can detect underlying types later
			b, _ := json.Marshal(v)
			_ = json.Unmarshal(b, &parsedInput)
			if parsedInput == nil {
				parsedInput = make(map[string]interface{})
			}
		}

		// ExpectedOutput may be raw string or already parsed
		var expected interface{}
		switch ev := tc.ExpectedOutput.(type) {
		case string:
			if err := json.Unmarshal([]byte(ev), &expected); err != nil {
				expected = coerceScalar(ev)
			}
		default:
			expected = ev
		}

		// Transform parsedInput (map) into an ordered slice based on ExpectedIoType.InputParameters
		// This is crucial for languages like JS where spreading an object spreads its keys, not values.
		var orderedInput []interface{}
		if len(p.ExpectedIoType.InputParameters) > 0 {
			orderedInput = make([]interface{}, len(p.ExpectedIoType.InputParameters))
			// Ensure parsedInput is a map before attempting keyed access
			if m, ok := parsedInput.(map[string]interface{}); ok {
				for i, param := range p.ExpectedIoType.InputParameters {
					if val, ok2 := m[param.Name]; ok2 {
						orderedInput[i] = val
					} else {
						// Handle case where a parameter is expected but not found in parsedInput
						// For now, we'll just use nil, but a more robust solution might error or use a default.
						orderedInput[i] = nil
					}
				}
			} else {
				// If parsedInput is not a map, try to treat it as a slice to fill positional params,
				// otherwise leave missing params as nil.
				for i := range orderedInput {
					orderedInput[i] = nil
				}
				if arr, ok := parsedInput.([]interface{}); ok {
					for i := 0; i < len(orderedInput) && i < len(arr); i++ {
						orderedInput[i] = arr[i]
					}
				}
			}
		} else {
			// Fallback: if no ExpectedIoType, try to get values from map (order not guaranteed)
			// Or if parsedInput is not a map, use it directly.
			if m, ok := parsedInput.(map[string]interface{}); ok {
				for _, v := range m {
					orderedInput = append(orderedInput, v)
				}
			} else {
				// If parsedInput is not a map, and no ExpectedIoType, just use it as is.
				// This handles cases where input is a single scalar or array directly.
				orderedInput = []interface{}{parsedInput}
			}
		}

		entry := map[string]interface{}{
			"input":          orderedInput, // Use the ordered slice here
			"expectedOutput": expected,
		}
		tests = append(tests, entry)
	}

	testsJSON, err := json.Marshal(tests)
	if err != nil {
		return "", fmt.Errorf("failed to marshal tests json: %w", err)
	}

	// Determine function/class name placeholders
	fnName := "solution" // default
	if p.FunctionName != nil {
		// pick entry for language if present
		if n, ok := p.FunctionName[lang.ID]; ok && n != "" {
			fnName = n
		}
	}

	// Replace placeholders
	tpl = strings.ReplaceAll(tpl, "{{TESTS_JSON}}", string(testsJSON))
	tpl = strings.ReplaceAll(tpl, "{{FUNCTION_NAME}}", fnName)
	// For Java templates
	className := "Main"
	if p.FunctionSignature.Language == "java" {
		className = strings.TrimSuffix(fnName, "")
	}
	tpl = strings.ReplaceAll(tpl, "{{CLASS_NAME}}", className)

	return tpl, nil
}

// parseInputRaw attempts to create a map[string]interface{} from the raw input
// string using the ExpectedIoType guidance. Supported patterns:
// - lines like: "name = <json>" (JSON RHS parsed)
// - positional lines when names not present, mapped to InputParameters order
// - if ExpectedIoType empty, attempts to unmarshal the whole raw string as JSON
func parseInputRaw(raw string, expected models.ExpectedIoType) (map[string]interface{}, error) {
	out := make(map[string]interface{})
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out, nil
	}

	lines := strings.Split(raw, "\n")

	// first try named assignments
	namedFound := false
	for _, line := range lines {
		if strings.Contains(line, "=") {
			namedFound = true
			parts := strings.SplitN(line, "=", 2)
			name := strings.TrimSpace(parts[0])
			rhs := strings.TrimSpace(parts[1])
			var val interface{}
			// Try JSON first
			if err := json.Unmarshal([]byte(rhs), &val); err != nil {
				// Try list/CSV or scalar coercion
				val = parsePossibleListOrScalar(rhs)
			}
			out[name] = val
		}
	}
	if namedFound {
		return out, nil
	}

	// If no named lines, but expected input params exist, parse positionally
	if len(expected.InputParameters) > 0 {
		for i, param := range expected.InputParameters {
			if i >= len(lines) {
				break
			}
			s := strings.TrimSpace(lines[i])
			var val interface{}
			if err := json.Unmarshal([]byte(s), &val); err != nil {
				val = parsePossibleListOrScalar(s)
			}
			out[param.Name] = val
		}
		return out, nil
	}

	// As a last resort, try to unmarshal entire raw as JSON into a single input param named "input"
	var v interface{}
	if err := json.Unmarshal([]byte(raw), &v); err == nil {
		out["input"] = normalizeValue(v)
		return out, nil
	}

	// Try to parse as CSV/space-delimited or scalar
	out["input"] = parsePossibleListOrScalar(raw)
	return out, nil
}

// coerceScalar attempts to interpret an unquoted scalar string as int/float/bool or returns trimmed string
func coerceScalar(s string) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if b, err := strconv.ParseBool(s); err == nil {
		return b
	}
	if i, err := strconv.Atoi(s); err == nil {
		return i
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	// strip surrounding quotes if present
	if (strings.HasPrefix(s, "\"") && strings.HasSuffix(s, "\"")) || (strings.HasPrefix(s, "'") && strings.HasSuffix(s, "'")) {
		return strings.Trim(s, "\"'")
	}
	return s
}

// parsePossibleListOrScalar tries to interpret a string as a JSON array, CSV list, space-delimited list, or scalar
func parsePossibleListOrScalar(s string) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// If looks like [ ... ] or { ... } or starts with quote, try JSON
	if strings.HasPrefix(s, "[") || strings.HasPrefix(s, "{") || strings.HasPrefix(s, "\"") || strings.HasPrefix(s, "'") {
		var v interface{}
		if err := json.Unmarshal([]byte(s), &v); err == nil {
			return v
		}
	}
	// CSV like: 1,2,3  or a,b,c
	if strings.Contains(s, ",") {
		parts := strings.Split(s, ",")
		out := make([]interface{}, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if v := tryParseNumberOrBool(p); v != nil {
				out = append(out, v)
			} else if parsed := tryParseJSON(p); parsed != nil {
				out = append(out, normalizeValue(parsed))
			} else {
				out = append(out, strings.Trim(p, "'\""))
			}
		}
		return out
	}
	// space-delimited numbers: "1 2 3"
	if strings.Contains(s, " ") {
		toks := strings.Fields(s)
		allNum := true
		vals := make([]interface{}, 0, len(toks))
		for _, t := range toks {
			if v := tryParseNumberOrBool(t); v != nil {
				vals = append(vals, v)
			} else {
				allNum = false
				break
			}
		}
		if allNum {
			return vals
		}
	}
	// fallback scalar
	if v := tryParseNumberOrBool(s); v != nil {
		return v
	}
	// strip quotes
	if (strings.HasPrefix(s, "\"") && strings.HasSuffix(s, "\"")) || (strings.HasPrefix(s, "'") && strings.HasSuffix(s, "'")) {
		return strings.Trim(s, "\"'")
	}
	return s
}

func tryParseJSON(s string) interface{} {
	var v interface{}
	if err := json.Unmarshal([]byte(s), &v); err == nil {
		return v
	}
	return nil
}

// normalizeValue converts float64 values that are whole numbers into ints, and recursively normalizes arrays and objects
func normalizeValue(v interface{}) interface{} {
	switch t := v.(type) {
	case float64:
		if float64(int64(t)) == t {
			return int(t)
		}
		return t
	case []interface{}:
		out := make([]interface{}, len(t))
		for i, vv := range t {
			out[i] = normalizeValue(vv)
		}
		return out
	case map[string]interface{}:
		m := make(map[string]interface{}, len(t))
		for k, vv := range t {
			m[k] = normalizeValue(vv)
		}
		return m
	default:
		return v
	}
}

func tryParseNumberOrBool(s string) interface{} {
	if i, err := strconv.Atoi(s); err == nil {
		return i
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	if b, err := strconv.ParseBool(s); err == nil {
		return b
	}
	return nil
}
