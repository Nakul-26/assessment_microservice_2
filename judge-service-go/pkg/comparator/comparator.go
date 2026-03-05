package comparator

import (
	"math"
	"reflect"

	"judge-service-go/pkg/models"
)

func Compare(expected, actual interface{}, cfg models.CompareConfig) bool {
	tolerance := cfg.FloatTolerance
	if tolerance < 0 {
		tolerance = 0
	}
	return compareValue(expected, actual, tolerance, cfg.OrderInsensitive)
}

func compareValue(expected, actual interface{}, tolerance float64, orderInsensitive bool) bool {
	if expected == nil || actual == nil {
		return expected == nil && actual == nil
	}

	if en, ok := asFloat64(expected); ok {
		an, ok := asFloat64(actual)
		if !ok {
			return false
		}
		return compareNumbers(en, an, tolerance)
	}

	if em, ok := toStringMap(expected); ok {
		am, ok := toStringMap(actual)
		if !ok || len(em) != len(am) {
			return false
		}
		for k, ev := range em {
			av, exists := am[k]
			if !exists {
				return false
			}
			if !compareValue(ev, av, tolerance, orderInsensitive) {
				return false
			}
		}
		return true
	}

	if es, ok := toSlice(expected); ok {
		as, ok := toSlice(actual)
		if !ok || len(es) != len(as) {
			return false
		}
		if orderInsensitive {
			return compareSlicesUnordered(es, as, tolerance, orderInsensitive)
		}
		for i := 0; i < len(es); i++ {
			if !compareValue(es[i], as[i], tolerance, orderInsensitive) {
				return false
			}
		}
		return true
	}

	return reflect.DeepEqual(expected, actual)
}

func compareNumbers(expected, actual, tolerance float64) bool {
	if tolerance > 0 {
		return math.Abs(expected-actual) <= tolerance
	}
	return expected == actual
}

func compareSlicesUnordered(expected, actual []interface{}, tolerance float64, orderInsensitive bool) bool {
	used := make([]bool, len(actual))
	for _, ev := range expected {
		match := -1
		for i, av := range actual {
			if used[i] {
				continue
			}
			if compareValue(ev, av, tolerance, orderInsensitive) {
				match = i
				break
			}
		}
		if match == -1 {
			return false
		}
		used[match] = true
	}
	return true
}

func asFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int8:
		return float64(n), true
	case int16:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint8:
		return float64(n), true
	case uint16:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint64:
		return float64(n), true
	default:
		return 0, false
	}
}

func toSlice(v interface{}) ([]interface{}, bool) {
	rv := reflect.ValueOf(v)
	if !rv.IsValid() {
		return nil, false
	}
	kind := rv.Kind()
	if kind != reflect.Slice && kind != reflect.Array {
		return nil, false
	}
	out := make([]interface{}, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		out[i] = rv.Index(i).Interface()
	}
	return out, true
}

func toStringMap(v interface{}) (map[string]interface{}, bool) {
	if m, ok := v.(map[string]interface{}); ok {
		return m, true
	}
	rv := reflect.ValueOf(v)
	if !rv.IsValid() || rv.Kind() != reflect.Map || rv.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	out := make(map[string]interface{}, rv.Len())
	iter := rv.MapRange()
	for iter.Next() {
		out[iter.Key().String()] = iter.Value().Interface()
	}
	return out, true
}
