import * as React from 'react';
import { getLocation } from 'graphql';
import {
  SimplifiedArg,
  SimplifiedField,
  SimplifiedTypeBase,
} from '../../introspection/types';

import './SourceLink.css';

export type SourceLinkCreator = (
  filepath: string,
  location: { line: number; column: number },
) => string;

function sourceLinkCreator(astNode: any, linkCreator: SourceLinkCreator) {
  const loc = astNode.loc;
  const filepath = loc.source.name;
  const location = getLocation(
    loc.source,
    astNode.description?.loc?.endToken?.next?.start
      ? astNode.description.loc.endToken.next.start
      : loc.start,
  );
  return linkCreator(filepath, location);
}

export function SourceLink({
  node,
  creator,
}: {
  node: SimplifiedTypeBase | SimplifiedArg | SimplifiedField<any>;
  creator?: SourceLinkCreator;
}) {
  if (!node.astNode || !creator) {
    return null;
  }

  return (
    <div>
      <a
        className="source-link"
        href={sourceLinkCreator(node.astNode, creator)}
      >
        Go to Source
      </a>
    </div>
  );
}
