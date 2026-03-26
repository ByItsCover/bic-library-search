export const health = async () => {
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Hello World',
        }),
    }
}
