import * as _ from 'lodash';

import {
  lexicographicSortSchema,
  concatAST,
  TypeKind,
  Kind,
  parse,
  Source,
  buildASTSchema,
  GraphQLSchema,
  GraphQLNamedType,
  isObjectType,
  GraphQLField,
  GraphQLArgument,
  GraphQLInputType,
  GraphQLOutputType,
  isNonNullType,
  isListType,
  isInterfaceType,
  isUnionType,
  isEnumType,
  isInputObjectType,
  isIntrospectionType,
} from 'graphql';
import {
  SimplifiedIntrospection,
  SimplifiedIntrospectionWithIds,
  SimplifiedType,
} from './types';
import { typeNameToId } from './utils';
import { Sources } from '../components/Voyager';

function toTypeKind<K extends keyof typeof Kind>(kind: typeof Kind[K]) {
  const convertMap = {
    [Kind.SCALAR_TYPE_DEFINITION]: TypeKind.SCALAR,
    [Kind.OBJECT_TYPE_DEFINITION]: TypeKind.OBJECT,
    [Kind.INTERFACE_TYPE_DEFINITION]: TypeKind.INTERFACE,
    [Kind.UNION_TYPE_DEFINITION]: TypeKind.UNION,
    [Kind.ENUM_TYPE_DEFINITION]: TypeKind.ENUM,
    [Kind.INPUT_OBJECT_TYPE_DEFINITION]: TypeKind.INPUT_OBJECT,
    [Kind.LIST_TYPE]: TypeKind.LIST,
    [Kind.NON_NULL_TYPE]: TypeKind.NON_NULL,
  };

  if (kind in convertMap) {
    return convertMap[kind as any];
  }

  throw new Error(`Cannot convert ${kind} to TypeKind`);
}

function unwrapType(
  type: GraphQLInputType | GraphQLOutputType,
  wrappers: Array<typeof TypeKind.NON_NULL | typeof TypeKind.LIST>,
) {
  while (isNonNullType(type) || isListType(type)) {
    wrappers.push(isNonNullType(type) ? TypeKind.NON_NULL : TypeKind.LIST);
    type = type.ofType;
  }

  return type.name;
}

function convertArg(inArg: GraphQLArgument) {
  const outArg = <any>{
    name: inArg.name,
    description: inArg.description,
    defaultValue: inArg.defaultValue,
    typeWrappers: [],
    astNode: inArg.astNode
  };
  outArg.type = unwrapType(inArg.type, outArg.typeWrappers);

  return outArg;
}

let convertInputField = convertArg;

function convertField(inField: GraphQLField<any, any>) {
  const outField = <any>{
    name: inField.name,
    description: inField.description,
    typeWrappers: [],
    isDeprecated: inField.isDeprecated,
    astNode: inField.astNode
  };

  outField.type = unwrapType(inField.type, outField.typeWrappers);

  outField.args = _(inField.args).map(convertArg).keyBy('name').value();

  if (outField.isDeprecated)
    outField.deprecationReason = inField.deprecationReason;

  return outField;
}

function convertType(inType: GraphQLNamedType): SimplifiedType {
  const typeKind = toTypeKind(
    ['ID', 'String', 'Int', 'Float', 'Boolean'].includes(inType.name)
      ? 'ScalarTypeDefinition'
      : inType.astNode.kind,
  );
  const outType: SimplifiedType = {
    kind: typeKind,
    name: inType.name,
    description: inType.description,
    astNode: inType.astNode,
  };

  if (isObjectType(inType)) {
    outType.interfaces = _(inType.getInterfaces()).map('name').uniq().value();
    outType.fields = _(Object.values(inType.getFields()))
      .map(convertField)
      .keyBy('name')
      .value();
  } else if (isInterfaceType(inType)) {
    outType.derivedTypes = _(inType.getInterfaces()).map('name').uniq().value();
    outType.fields = _(Object.values(inType.getFields()))
      .map(convertField)
      .keyBy('name')
      .value();
  } else if (isUnionType(inType)) {
    outType.possibleTypes = _(inType.getTypes()).map('name').uniq().value();
  } else if (isEnumType(inType)) {
    outType.enumValues = inType.getValues().slice();
  } else if (isInputObjectType(inType)) {
    outType.inputFields = _(Object.values(inType.getFields()))
      .map(convertInputField)
      .keyBy('name')
      .value();
  }

  return outType;
}

function simplifySchema(schema: GraphQLSchema): SimplifiedIntrospection {
  return {
    types: _(
      Object.values(schema.getTypeMap()).filter(
        (type) => !isIntrospectionType(type),
      ),
    )
      .map(convertType)
      .keyBy('name')
      .value(),
    queryType: schema.getQueryType().name,
    mutationType: schema.getMutationType()?.name ?? null,
    subscriptionType: schema.getSubscriptionType()?.name ?? null,
    //FIXME:
    //directives:
  };
}

function markRelayTypes(schema: SimplifiedIntrospectionWithIds): void {
  const nodeType = schema.types[typeNameToId('Node')];
  if (nodeType) nodeType.isRelayType = true;

  const pageInfoType = schema.types[typeNameToId('PageInfo')];
  if (pageInfoType) pageInfoType.isRelayType = true;

  const edgeTypesMap = {};

  _.each(schema.types, (type) => {
    if (!_.isEmpty(type.interfaces)) {
      type.interfaces = _.reject(
        type.interfaces,
        (baseType) => baseType.type.name === 'Node',
      );
    }

    _.each(type.fields, (field) => {
      const connectionType = field.type;
      if (
        !/.Connection$/.test(connectionType.name) ||
        connectionType.kind !== 'OBJECT' ||
        !connectionType.fields.edges
      ) {
        return;
      }

      const edgesType = connectionType.fields.edges.type;
      if (edgesType.kind !== 'OBJECT' || !edgesType.fields.node) {
        return;
      }

      const nodeType = edgesType.fields.node.type;

      connectionType.isRelayType = true;
      edgesType.isRelayType = true;

      edgeTypesMap[edgesType.name] = nodeType;

      field.relayType = field.type;
      field.type = nodeType;
      field.typeWrappers = ['LIST'];

      const relayArgNames = ['first', 'last', 'before', 'after'];
      const isRelayArg = (arg) => relayArgNames.includes(arg.name);
      field.relayArgs = _.pickBy(field.args, isRelayArg);
      field.args = _.omitBy(field.args, isRelayArg);
    });
  });

  _.each(schema.types, (type) => {
    _.each(type.fields, (field) => {
      const realType = edgeTypesMap[field.type.name];
      if (realType === undefined) return;

      field.relayType = field.type;
      field.type = realType;
    });
  });

  const { queryType } = schema;
  let query = schema.types[queryType.id];

  if (_.get(query, 'fields.node.type.isRelayType')) {
    delete query.fields['node'];
  }

  //GitHub use `nodes` instead of `node`.
  if (_.get(query, 'fields.nodes.type.isRelayType')) {
    delete query.fields['nodes'];
  }

  if (_.get(query, 'fields.relay.type') === queryType) {
    delete query.fields['relay'];
  }
}

function markDeprecated(schema: SimplifiedIntrospectionWithIds): void {
  // Remove deprecated fields.
  _.each(schema.types, (type) => {
    type.fields = _.pickBy(type.fields, (field) => !field.isDeprecated);
  });

  // We can't remove types that end up being empty
  // because we cannot be sure that the @deprecated directives where
  // consistently added to the schema we're handling.
  //
  // Entities may have non deprecated fields pointing towards entities
  // which are deprecated.
}

function assignTypesAndIDs(schema: SimplifiedIntrospection) {
  (<any>schema).queryType = schema.types[schema.queryType];
  (<any>schema).mutationType = schema.types[schema.mutationType];
  (<any>schema).subscriptionType = schema.types[schema.subscriptionType];

  _.each(schema.types, (type: any) => {
    type.id = typeNameToId(type.name);

    _.each(type.inputFields, (field: any) => {
      field.id = `FIELD::${type.name}::${field.name}`;
      field.type = schema.types[field.type];
    });

    _.each(type.fields, (field: any) => {
      field.id = `FIELD::${type.name}::${field.name}`;
      field.type = schema.types[field.type];
      _.each(field.args, (arg: any) => {
        arg.id = `ARGUMENT::${type.name}::${field.name}::${arg.name}`;
        arg.type = schema.types[arg.type];
      });
    });

    if (!_.isEmpty(type.possibleTypes)) {
      type.possibleTypes = _.map(
        type.possibleTypes,
        (possibleType: string) => ({
          id: `POSSIBLE_TYPE::${type.name}::${possibleType}`,
          type: schema.types[possibleType],
        }),
      );
    }

    if (!_.isEmpty(type.derivedTypes)) {
      type.derivedTypes = _.map(type.derivedTypes, (derivedType: string) => ({
        id: `DERIVED_TYPE::${type.name}::${derivedType}`,
        type: schema.types[derivedType],
      }));
    }

    if (!_.isEmpty(type.interfaces)) {
      type.interfaces = _.map(type.interfaces, (baseType: string) => ({
        id: `INTERFACE::${type.name}::${baseType}`,
        type: schema.types[baseType],
      }));
    }
  });

  schema.types = _.keyBy(schema.types, 'id');
}

export function getSchema(
  sources: Sources,
  sortByAlphabet: boolean,
  skipRelay: boolean,
  skipDeprecated: boolean,
) {
  if (!sources) return null;

  const docs = concatAST(
    sources.map((source) => parse(new Source(source.content, source.filepath))),
  );
  let schema = buildASTSchema(docs);
  if (sortByAlphabet) {
    schema = lexicographicSortSchema(schema);
  }

  let simpleSchema = simplifySchema(schema);

  assignTypesAndIDs(simpleSchema);

  if (skipRelay) {
    markRelayTypes((<any>simpleSchema) as SimplifiedIntrospectionWithIds);
  }
  if (skipDeprecated) {
    markDeprecated((<any>simpleSchema) as SimplifiedIntrospectionWithIds);
  }

  console.log({ simpleSchema });

  return simpleSchema;
}
