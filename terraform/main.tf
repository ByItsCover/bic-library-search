locals {
  lambda_role_arn       = data.terraform_remote_state.bic_infra.outputs.lambda_function_role_arn
  api_gw_arn            = data.terraform_remote_state.bic_infra.outputs.api_gw_arn
  s3_db_uri             = data.terraform_remote_state.bic_infra.outputs.s3_db_uri
  hardcover_secret_name = data.terraform_remote_state.bic_infra.outputs.hardcover_secret_name
  cognito_user_pool_id        = data.terraform_remote_state.bic_infra.outputs.auth_user_pool_id
  cognito_user_pool_client_id = data.terraform_remote_state.bic_site.outputs.cognito_pool_client_id
  sqs_url               = data.terraform_remote_state.bic_infra.outputs.sqs_url
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
      ENVIRONMENT           = var.environment
      DB_URI                = local.s3_db_uri
      HARDCOVER_SECRET_NAME = local.hardcover_secret_name
      COGNITO_USER_POOL_ID  = local.cognito_user_pool_id,
      COGNITO_CLIENT_ID     = local.cognito_user_pool_client_id
      SQS_URL               = local.sqs_url
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
