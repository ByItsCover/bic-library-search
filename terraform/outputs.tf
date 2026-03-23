
output "library_search_url" {
  value = aws_apigatewayv2_stage.search_stage.invoke_url
}
