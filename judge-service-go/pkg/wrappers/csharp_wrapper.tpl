using System;
using System.IO;
using System.Collections.Generic;
using System.Json;
using System.Reflection;

public class Wrapper
{
    // User's code will be included here, assuming it's in a class named "UserSolution"
    // and has a method named {{FUNCTION_NAME}}
    {{USER_CODE}}

    public static void Main(string[] args)
    {
        string testsJsonStr = Environment.GetEnvironmentVariable("TESTS_JSON");
        if (string.IsNullOrEmpty(testsJsonStr))
        {
            Console.Error.WriteLine("TESTS_JSON environment variable not set");
            return;
        }

        JsonValue parsedJson;
        try
        {
            parsedJson = JsonValue.Parse(testsJsonStr);
        }
        catch (Exception)
        {
            Console.Error.WriteLine("Invalid JSON in test cases");
            return;
        }

        int numTests = parsedJson.Count;
        int passedTests = 0;

        var results = new List<JsonObject>();

        for (int i = 0; i < numTests; i++)
        {
            JsonValue testCase = parsedJson[i];
            JsonValue inputJson = testCase["input"];
            JsonValue expectedJson = testCase["expectedOutput"];

            // Simplified: assumes a single integer argument
            int input = (int)inputJson[0];
            int expected = (int)expectedJson;

            try
            {
                var solution = new UserSolution();
                MethodInfo method = typeof(UserSolution).GetMethod("{{FUNCTION_NAME}}");
                object output = method.Invoke(solution, new object[] { input });

                bool ok = output.Equals(expected);
                if (ok)
                {
                    passedTests++;
                }

                var result = new JsonObject
                {
                    ["test"] = i + 1,
                    ["ok"] = ok,
                    ["output"] = output.ToString(),
                    ["expected"] = expected.ToString()
                };
                results.Add(result);
            }
            catch (Exception e)
            {
                var result = new JsonObject
                {
                    ["test"] = i + 1,
                    ["ok"] = false,
                    ["error"] = e.Message,
                    ["traceback"] = e.StackTrace
                };
                results.Add(result);
            }
        }

        var summary = new JsonObject
        {
            ["status"] = "finished",
            ["passed"] = passedTests,
            ["total"] = numTests,
            ["details"] = new JsonArray(results)
        };

        Console.WriteLine(summary.ToString());
    }
}

// The user's code will be placed here. For example:
// public class UserSolution {
//     public int {{FUNCTION_NAME}}(int n) {
//         // user implementation
//         return n;
//     }
// }
