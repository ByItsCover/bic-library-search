locals {
  lambda_role_arn = data.terraform_remote_state.bic_infra.outputs.lambda_function_role_arn
  api_gw_arn      = data.terraform_remote_state.bic_infra.outputs.api_gw_arn
}

resource "aws_lambda_function" "search_function" {
  function_name = var.lambda_name
  image_uri     = data.aws_ecr_image.search_image.image_uri
  package_type  = "Image"

  memory_size = var.lambda_memory
  timeout     = var.lambda_timeout

  role = local.lambda_role_arn

  logging_config {
    log_format            = "JSON"
    application_log_level = var.log_level
    system_log_level      = "INFO"
  }

  environment {
    variables = {
      ENVIRONMENT = var.environment
    }
  }
}

resource "aws_lambda_permission" "public_access" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.search_function.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${local.api_gw_arn}/*/*"
}
