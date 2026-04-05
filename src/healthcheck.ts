export const health = async () => {
    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            message: 'Hello World',
        }),
    }
}
