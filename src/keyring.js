const {
    Secret
} = imports.gi;

var NETWORK_CREDENTIALS = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.NetworkCredentials', 
    Secret.SchemaFlags.DONT_MATCH_NAME, {
        "uuid": Secret.SchemaAttributeType.STRING,
        "application": Secret.SchemaAttributeType.STRING,
    }
);

var SEARCH_NETWORK_CREDENTIALS = Secret.Schema.new('org.jorgeajimenezl.nauta-connect.SearchNetworkCredentials',
    Secret.SchemaFlags.DONT_MATCH_NAME, {
        "application": Secret.SchemaAttributeType.STRING,
    }
);