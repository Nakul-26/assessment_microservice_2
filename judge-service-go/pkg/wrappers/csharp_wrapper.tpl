using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Collections.Generic;
using System.Reflection;

// User's code will be included here (submission should NOT include a Main method).
// The submission should define a class named UserSolution that contains the method
// with the name {{FUNCTION_NAME}}. See contract below for expected method signatures.
{{USER_CODE}}

public static class Harness
{
    // Convert a JsonElement into a CLR object that best matches primitive types
    static object ConvertJsonElement(JsonElement el)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Number:
                // prefer integer if it fits
                if (el.TryGetInt64(out long l)) return l;
                if (el.TryGetDouble(out double d)) return d;
                // fallback to raw text
                return el.GetRawText();
            case JsonValueKind.String:
                return el.GetString();
            case JsonValueKind.True:
            case JsonValueKind.False:
                return el.GetBoolean();
            case JsonValueKind.Array:
            {
                // convert to object[]
                var arr = new List<object>();
                foreach (var it in el.EnumerateArray())
                {
                    arr.Add(ConvertJsonElement(it));
                }
                return arr.ToArray();
            }
            case JsonValueKind.Object:
            {
                // return a JsonElement string for now
                return el.GetRawText();
            }
            case JsonValueKind.Null:
            default:
                return null;
        }
    }

    // Try to coerce an object value to a target parameter type when possible
    static object CoerceToType(object value, Type targetType)
    {
        if (value == null)
        {
            if (targetType.IsValueType) return Activator.CreateInstance(targetType);
            return null;
        }

        if (targetType.IsAssignableFrom(value.GetType()))
            return value;

        try
        {
            // handle numeric conversions
            if (value is long lv)
            {
                if (targetType == typeof(int)) return (int)lv;
                if (targetType == typeof(long)) return lv;
                if (targetType == typeof(double)) return (double)lv;
                if (targetType == typeof(float)) return (float)lv;
            }
            if (value is double dv)
            {
                if (targetType == typeof(double)) return dv;
                if (targetType == typeof(float)) return (float)dv;
                if (targetType == typeof(long)) return (long)dv;
                if (targetType == typeof(int)) return (int)dv;
            }
            if (value is string sv)
            {
                if (targetType == typeof(string)) return sv;
                // try parse numbers
                if (targetType == typeof(long) && long.TryParse(sv, out var outL)) return outL;
                if (targetType == typeof(int) && int.TryParse(sv, out var outI)) return outI;
                if (targetType == typeof(double) && double.TryParse(sv, out var outD)) return outD;
            }
            // arrays -> try to convert element-wise to typed arrays if target is array
            if (value is object[] objArr && targetType.IsArray)
            {
                var elemType = targetType.GetElementType();
                var newArr = Array.CreateInstance(elemType, objArr.Length);
                for (int i = 0; i < objArr.Length; i++)
                {
                    newArr.SetValue(CoerceToType(objArr[i], elemType), i);
                }
                return newArr;
            }
            // fallback: try System.Convert
            return Convert.ChangeType(value, targetType);
        }
        catch
        {
            // fallback to original value
            return value;
        }
    }

    // Build a JSON summary object for the entire run
    static JsonDocument BuildSummary(List<JsonElement> details, int passed, int total)
    {
        using var doc = JsonDocument.Parse("{}");
        // We will build using Utf8JsonWriter into a MemoryStream then parse back for convenience
        var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = false }))
        {
            w.WriteStartObject();
            w.WriteString("status", "finished");
            w.WriteNumber("passed", passed);
            w.WriteNumber("total", total);
            w.WritePropertyName("details");
            w.WriteStartArray();
            foreach (var e in details)
            {
                e.WriteTo(w);
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }
        ms.Position = 0;
        return JsonDocument.Parse(ms);
    }

    public static int MainHarness()
    {
        string testsJsonStr = Environment.GetEnvironmentVariable("TESTS_JSON");
        if (string.IsNullOrEmpty(testsJsonStr))
        {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"TESTS_JSON environment variable not set\"}");
            return 2;
        }

        JsonDocument parsed;
        try
        {
            parsed = JsonDocument.Parse(testsJsonStr);
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"Invalid TESTS_JSON: " + JsonEncodedText.Encode(ex.Message) + "\"}");
            return 3;
        }

        if (parsed.RootElement.ValueKind != JsonValueKind.Array)
        {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"TESTS_JSON must be an array of test objects\"}");
            return 4;
        }

        var detailsList = new List<JsonElement>();
        int passed = 0;
        int total = parsed.RootElement.GetArrayLength();

        // Reflection: find the method in UserSolution
        Type solverType = typeof(UserSolution);
        string funcName = "{{FUNCTION_NAME}}";
        MethodInfo[] allMethods = solverType.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance);
        MethodInfo targetMethod = null;
        foreach (var m in allMethods)
        {
            if (m.Name == funcName)
            {
                targetMethod = m;
                break;
            }
        }
        if (targetMethod == null)
        {
            Console.WriteLine("{\"status\":\"error\",\"message\":\"Function " + funcName + " not found on UserSolution\"}");
            return 5;
        }

        bool isStatic = targetMethod.IsStatic;
        object instance = null;
        if (!isStatic)
        {
            try { instance = Activator.CreateInstance(solverType); }
            catch (Exception ex) {
                Console.WriteLine("{\"status\":\"error\",\"message\":\"failed to create UserSolution instance: " + JsonEncodedText.Encode(ex.Message) + "\"}");
                return 6;
            }
        }

        // iterate tests
        int testIndex = 0;
        foreach (var testElement in parsed.RootElement.EnumerateArray())
        {
            testIndex++;
            try
            {
                if (testElement.ValueKind != JsonValueKind.Object)
                {
                    // build error detail
                    var err = JsonDocument.Parse("{\"test\":