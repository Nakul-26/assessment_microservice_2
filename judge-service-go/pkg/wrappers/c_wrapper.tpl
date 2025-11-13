#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <json-c/json.h>

// User's code will be included here
#include "main.c"

void print_json_result(int test_num, int ok, const char* output, const char* expected) {
    struct json_object *jobj = json_object_new_object();
    json_object_object_add(jobj, "test", json_object_new_int(test_num));
    json_object_object_add(jobj, "ok", json_object_new_boolean(ok));
    json_object_object_add(jobj, "output", json_object_new_string(output));
    json_object_object_add(jobj, "expected", json_object_new_string(expected));
    printf("%s,\n", json_object_to_json_string(jobj));
}

int main() {
    const char* tests_json_str = getenv("TESTS_JSON");
    if (!tests_json_str) {
        fprintf(stderr, "TESTS_JSON environment variable not set\n");
        return 1;
    }

    struct json_object *parsed_json = json_tokener_parse(tests_json_str);
    if (!parsed_json) {
        fprintf(stderr, "Invalid JSON in test cases\n");
        return 1;
    }

    int num_tests = json_object_array_length(parsed_json);
    int passed_tests = 0;

    printf("{\n");
    printf("\"status\": \"finished\",\n");
    printf("\"details\": [\n");

    for (int i = 0; i < num_tests; i++) {
        struct json_object *test_case = json_object_array_get_idx(parsed_json, i);
        struct json_object *input_obj = json_object_object_get(test_case, "input");
        struct json_object *expected_obj = json_object_object_get(test_case, "expectedOutput");

        // This is a very simplified example. It assumes the function takes one integer argument
        // and returns an integer. A real implementation would need more sophisticated
        // argument parsing and function calling based on the problem definition.
        int input = json_object_get_int(json_object_array_get_idx(input_obj, 0));
        int expected = json_object_get_int(expected_obj);

        int output = {{FUNCTION_NAME}}(input);

        char output_str[50];
        char expected_str[50];
        sprintf(output_str, "%d", output);
        sprintf(expected_str, "%d", expected);

        int ok = (output == expected);
        if (ok) {
            passed_tests++;
        }
        print_json_result(i + 1, ok, output_str, expected_str);
    }

    printf("],\n");
    printf("\"passed\": %d,\n", passed_tests);
    printf("\"total\": %d\n", num_tests);
    printf("}\n");

    json_object_put(parsed_json);

    return 0;
}
